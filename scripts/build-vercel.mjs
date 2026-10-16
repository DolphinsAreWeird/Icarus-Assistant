// Builds the static part of the hosted demo for Vercel (see docs/hosting-vercel.md).
//
//   node scripts/build-vercel.mjs [--out <dir>]      default output: vercel-dist (or $ICARUS_VERCEL_OUT)
//
// Output layout mirrors what the voice server does: the built app (frontend/dist) is served under /app/.
// Only static files are produced. The stateful service (Node voice server + Python backend) stays where it is.
//
// Guard: on Vercel (VERCEL set), refuse to build while vercel.json still points at the placeholder service origin,
// because every /api, /brain and /mock request would then go to a host that is not yours.
// Set ICARUS_ALLOW_PLACEHOLDER_ORIGIN=1 to override (static-only preview).
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argOut = process.argv.indexOf('--out');
const out = path.resolve(root, argOut > 0 ? process.argv[argOut + 1] : process.env.ICARUS_VERCEL_OUT ?? 'vercel-dist');

const PLACEHOLDER = 'YOUR-ICARUS-SERVICE';

if (process.env.VERCEL && !process.env.ICARUS_ALLOW_PLACEHOLDER_ORIGIN) {
  const cfg = await readFile(path.join(root, 'vercel.json'), 'utf8');
  if (cfg.includes(PLACEHOLDER)) {
    console.error(`vercel.json still points at ${PLACEHOLDER}. Replace it with your service's origin (docs/hosting-vercel.md), or set ICARUS_ALLOW_PLACEHOLDER_ORIGIN=1.`);
    process.exit(1);
  }
}

const frontend = path.join(root, 'frontend');
if (!existsSync(path.join(frontend, 'node_modules'))) {
  console.error('frontend/node_modules is missing. Run: npm --prefix frontend ci');
  process.exit(1);
}
const build = spawnSync(process.execPath, [path.join(frontend, 'scripts/build.mjs')], { cwd: frontend, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(path.join(frontend, 'dist'), path.join(out, 'app'), { recursive: true });
console.log(`Static app written to ${path.relative(root, out) || '.'}/app (served at /app/).`);
