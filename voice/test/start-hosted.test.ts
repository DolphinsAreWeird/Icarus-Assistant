import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../scripts/start-hosted.sh', import.meta.url)).split(path.sep).join('/');
const hasBash = spawnSync('bash', ['-c', 'command -v python && echo ok']).status === 0;
// Port 1 is never served, so a backend already running on the default 8001 can't make these pass by accident.
const UNUSED_URL = 'http://127.0.0.1:1/ready';

describe.skipIf(!hasBash)('scripts/start-hosted.sh', () => {
  for (const [name, cmd] of [['hung backend', 'sleep 30'], ['crashed backend', 'false']] as const) {
    it(`exits nonzero and never starts the voice server: ${name}`, () => {
      const r = spawnSync('bash', [script], {
        encoding: 'utf8', timeout: 30_000,
        env: { ...process.env, HOSTED_BACKEND_CMD: cmd, HOSTED_BACKEND_READY_URL: UNUSED_URL, HOSTED_BACKEND_WAIT_S: '2', HOSTED_VOICE_CMD: 'echo VOICE_STARTED' },
      });
      expect(r.status).toBe(1);
      expect(r.stdout).not.toContain('VOICE_STARTED');
      expect(r.stderr).toContain('never became ready');
    });
  }
  it('gives up as soon as the backend process exits, without waiting out the full budget', () => {
    const started = Date.now();
    const r = spawnSync('bash', [script], {
      encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, HOSTED_BACKEND_CMD: 'false', HOSTED_BACKEND_READY_URL: UNUSED_URL, HOSTED_BACKEND_WAIT_S: '25', HOSTED_VOICE_CMD: 'echo VOICE_STARTED' },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('exited during startup');
    expect(Date.now() - started).toBeLessThan(20_000);
  });
  it('starts the voice server once the backend is ready, and stops the backend when voice exits', () => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const r = spawnSync('bash', [script], {
      encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, HOSTED_BACKEND_CMD: `python -m http.server ${port} --bind 127.0.0.1`,
        HOSTED_BACKEND_READY_URL: `http://127.0.0.1:${port}/`, HOSTED_BACKEND_WAIT_S: '20', HOSTED_VOICE_CMD: 'echo VOICE_STARTED' },
    });
    expect(r.stdout).toContain('VOICE_STARTED');
    expect(r.stdout).toContain('A server stopped');
    expect(r.status).toBe(1);
  });
});
