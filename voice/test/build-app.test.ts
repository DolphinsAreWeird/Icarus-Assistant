import { afterEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error plain .mjs helper
import { exitFromResult, npmInvocation } from '../scripts/lib/npm.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const devFake = path.join(here, '../scripts/dev-fake.mjs');
const buildApp = path.join(here, '../scripts/build-app.mjs');
const never = () => false;

describe('npmInvocation', () => {
  it('uses node + npm_execpath when available (no shell)', () => {
    const execpath = String.raw`C:\nodejs\node_modules\npm\bin\npm-cli.js`;
    const inv = npmInvocation(['run', 'build'], { env: { npm_execpath: execpath }, platform: 'win32', nodePath: 'node.exe' });
    expect(inv).toEqual({ command: 'node.exe', args: [execpath, 'run', 'build'], shell: false });
  });
  it('accepts pnpm/yarn .cjs entry points too', () => {
    const inv = npmInvocation(['run', 'dev'], { env: { npm_execpath: '/x/pnpm/bin/pnpm.cjs' }, platform: 'linux', nodePath: '/usr/bin/node' });
    expect(inv).toEqual({ command: '/usr/bin/node', args: ['/x/pnpm/bin/pnpm.cjs', 'run', 'dev'], shell: false });
  });
  it('on win32 prefers the npm-cli.js bundled next to node.exe, ignoring a non-JS npm_execpath', () => {
    const nodePath = String.raw`C:\Program Files\nodejs\node.exe`;
    const bundled = String.raw`C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js`;
    const inv = npmInvocation(['run', 'build'], {
      env: { npm_execpath: String.raw`C:\pnpm\pnpm.exe` },
      platform: 'win32',
      nodePath,
      exists: (p: string) => p === bundled,
    });
    expect(inv).toEqual({ command: nodePath, args: [bundled, 'run', 'build'], shell: false });
  });
  it('falls back to npm.cmd through cmd.exe as a single command string on win32', () => {
    expect(npmInvocation(['run', 'build'], { env: {}, platform: 'win32', exists: never })).toEqual({
      command: 'npm.cmd run build',
      args: [],
      shell: true,
    });
  });
  it('refuses shell metacharacters on the cmd.exe path', () => {
    expect(() => npmInvocation(['run', 'x&calc'], { env: {}, platform: 'win32', exists: never })).toThrow(/refusing/);
  });
  it('falls back to plain npm on POSIX', () => {
    expect(npmInvocation(['x'], { env: {}, platform: 'linux' })).toEqual({ command: 'npm', args: ['x'], shell: false });
  });
  it('ICARUS_NPM_BIN overrides the executable without a shell', () => {
    expect(npmInvocation(['run', 'dev'], { env: { ICARUS_NPM_BIN: 'fake-npm', npm_execpath: '/a/npm-cli.js' }, platform: 'win32' }))
      .toEqual({ command: 'fake-npm', args: ['run', 'dev'], shell: false });
  });
});

describe('exitFromResult', () => {
  it('treats spawn errors as failure', () => {
    const r = exitFromResult({ status: null, error: new Error('spawn npm ENOENT') });
    expect(r.code).toBe(1);
    expect(r.message).toContain('ENOENT');
  });
  it('treats signal termination as failure (128 + signal number)', () => {
    const r = exitFromResult({ status: null, signal: 'SIGTERM' });
    expect(r.code).toBe(143);
    expect(r.message).toContain('SIGTERM');
    expect(exitFromResult({ status: null, signal: null }).code).toBe(1);
  });
  it('propagates nonzero status and success', () => {
    expect(exitFromResult({ status: 3 }).code).toBe(3);
    expect(exitFromResult({ status: 0 })).toEqual({ code: 0, message: '' });
  });
});

// ICARUS_NPM_BIN=<node> makes the wrapper run `node run dev`, i.e. a file named `run` in its cwd.
let tmp: string | undefined;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});
function fakeNpmDir(runScript: string): string {
  tmp = mkdtempSync(path.join(tmpdir(), 'icarus-npm-'));
  writeFileSync(path.join(tmp, 'run'), runScript);
  return tmp;
}

describe('dev-fake.mjs', () => {
  it('exits nonzero with a message when npm cannot be spawned', () => {
    const r = spawnSync(process.execPath, [devFake], {
      env: { ...process.env, ICARUS_NPM_BIN: 'definitely-not-a-real-binary-xyz', npm_execpath: '' },
      encoding: 'utf8',
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('failed to start');
  });

  it('sets FAKE_ELEVENLABS=1, runs `run dev` and propagates the exit code', () => {
    const cwd = fakeNpmDir(
      "process.exit(process.env.FAKE_ELEVENLABS === '1' && process.argv[2] === 'dev' ? 7 : 2);",
    );
    const r = spawnSync(process.execPath, [devFake], {
      cwd,
      env: { ...process.env, ICARUS_NPM_BIN: process.execPath, FAKE_ELEVENLABS: '0' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(7);
    expect(r.stderr).toContain('[dev:fake] exited with code 7');
  });

  it.skipIf(process.platform === 'win32')('forwards SIGTERM to the dev server instead of orphaning it', async () => {
    const cwd = fakeNpmDir(
      "process.on('SIGTERM', () => { require('fs').writeFileSync('got-term', '1'); process.exit(0); });" +
        "console.log('ready'); setInterval(() => {}, 1000);",
    );
    const wrapper = spawn(process.execPath, [devFake], {
      cwd,
      env: { ...process.env, ICARUS_NPM_BIN: process.execPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise<void>((resolve) => wrapper.stdout.on('data', (d: Buffer) => d.toString().includes('ready') && resolve()));
    wrapper.kill('SIGTERM');
    const code = await new Promise<number | null>((resolve) => wrapper.once('exit', (c) => resolve(c)));
    expect(code).toBe(0);
    expect(existsSync(path.join(cwd, 'got-term'))).toBe(true);
  });
});

describe('build-app.mjs', () => {
  it.skipIf(!existsSync(path.join(here, '../../frontend/node_modules')))('exits nonzero when npm cannot be spawned', () => {
    const r = spawnSync(process.execPath, [buildApp], {
      env: { ...process.env, ICARUS_NPM_BIN: 'definitely-not-a-real-binary-xyz' },
      encoding: 'utf8',
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('[app] failed to start');
  });
});
