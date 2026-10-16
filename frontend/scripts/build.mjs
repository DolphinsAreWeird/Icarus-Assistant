// Bundles the app with esbuild into frontend/dist (served by the voice server at /app/).
//   npm run build      one build
//   npm run watch      rebuild on every change

import { build, context } from 'esbuild';
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

const options = {
  entryPoints: [path.join(root, 'src/main.ts')],
  outfile: path.join(dist, 'app.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  minify: !watch,
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  logLevel: 'info',
};

async function copyStatic() {
  await mkdir(dist, { recursive: true });
  await cp(path.join(root, 'src/index.html'), path.join(dist, 'index.html'));
  await cp(path.join(root, 'prototype'), path.join(dist, 'prototype'), { recursive: true });
  // Real mascot images, if the team has added them.
  const mascots = path.join(root, 'public/mascot');
  // The QR code in the top right corner (src/qr-code.ts).
  if (await stat(path.join(root, 'public/qr.png')).then(() => true, () => false)) await cp(path.join(root, 'public/qr.png'), path.join(dist, 'qr.png'));
  if (await stat(mascots).then(() => true, () => false)) await cp(mascots, path.join(dist, 'mascot'), { recursive: true });
}

if (!watch) await rm(dist, { recursive: true, force: true });
await copyStatic();
if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('Watching. Rebuilds on change (reload the page to see it).');
} else {
  await build(options);
}
