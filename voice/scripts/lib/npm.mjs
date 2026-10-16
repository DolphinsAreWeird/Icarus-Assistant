// Portable npm invocation + exit-code mapping shared by build-app.mjs and dev-fake.mjs.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { constants } from 'node:os';
import path from 'node:path';

// Only fixed script names and flags are ever passed; refuse anything a shell could interpret.
const SAFE_ARG = /^[\w:.@/=-]+$/;

// How to launch npm, never through a shell when avoidable:
// 1. ICARUS_NPM_BIN (test hook): that executable, no shell.
// 2. `node <npm_execpath>` when started by a package manager whose entry point is a JS file
//    (npm always sets npm-cli.js; pnpm/yarn set their own .cjs/.js, which also understand `run <script>`).
// 3. Windows: the npm-cli.js bundled next to node.exe (standard installer and nvm-windows layout).
// 4. Windows last resort: `npm.cmd` through cmd.exe (Node >= 18.20 refuses to spawn .cmd without a shell).
//    Passed as one command string so Node 24 does not warn (DEP0190); args are checked against SAFE_ARG.
// 5. Elsewhere: plain `npm`.
export function npmInvocation(
  args,
  { env = process.env, platform = process.platform, nodePath = process.execPath, exists = existsSync } = {},
) {
  if (env.ICARUS_NPM_BIN) return { command: env.ICARUS_NPM_BIN, args, shell: false };
  const execpath = env.npm_execpath;
  if (execpath && /\.[cm]?js$/i.test(execpath)) return { command: nodePath, args: [execpath, ...args], shell: false };
  if (platform === 'win32') {
    const bundled = path.win32.join(path.win32.dirname(nodePath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (exists(bundled)) return { command: nodePath, args: [bundled, ...args], shell: false };
    const unsafe = args.find((a) => !SAFE_ARG.test(a));
    if (unsafe !== undefined) throw new Error(`refusing to pass ${JSON.stringify(unsafe)} through cmd.exe`);
    return { command: ['npm.cmd', ...args].join(' '), args: [], shell: true };
  }
  return { command: 'npm', args, shell: false };
}

// Map a child result to { code, message }. Spawn errors and signal kills are failures.
export function exitFromResult(result, label = 'npm') {
  if (result.error) return { code: 1, message: `[${label}] failed to start: ${result.error.message}` };
  if (result.status === null || result.status === undefined) {
    const signo = result.signal ? constants.signals[result.signal] : undefined;
    return { code: signo ? 128 + signo : 1, message: `[${label}] terminated by signal ${result.signal ?? 'unknown'}` };
  }
  if (result.status !== 0) return { code: result.status, message: `[${label}] exited with code ${result.status}` };
  return { code: 0, message: '' };
}

// Short-lived npm run (build steps).
export function runNpm(args, options = {}, label = 'npm') {
  const inv = npmInvocation(args, options);
  const result = spawnSync(inv.command, inv.args, { cwd: options.cwd, env: options.env, stdio: 'inherit', shell: inv.shell });
  return exitFromResult(result, label);
}

// Long-running npm run (dev servers): stays alive until the child exits and forwards stop signals to it,
// so killing this wrapper (a supervisor's SIGTERM, `kill <pid>`) does not orphan the server.
// On Windows, Ctrl+C/Ctrl+Break already reach every process on the console, and child.kill() there is a
// hard TerminateProcess, so those are not forwarded; the handler only keeps us alive to report the exit code.
export function runNpmAsync(args, options = {}, label = 'npm') {
  const inv = npmInvocation(args, options);
  const child = spawn(inv.command, inv.args, { cwd: options.cwd, env: options.env, stdio: 'inherit', shell: inv.shell });
  const consoleSignals = new Set(process.platform === 'win32' ? ['SIGINT', 'SIGBREAK'] : []);
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP', ...(process.platform === 'win32' ? ['SIGBREAK'] : [])];
  const forward = (signal) => {
    if (consoleSignals.has(signal)) return;
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  };
  for (const s of signals) process.on(s, forward);
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      for (const s of signals) process.off(s, forward);
      resolve(exitFromResult(result, label));
    };
    child.once('error', (error) => finish({ error }));
    child.once('exit', (status, signal) => finish({ status, signal }));
  });
}
