// Bundles the browser code with esbuild (no config files, no framework).
//   dist/icarus-voice.js   the module Oasis imports (ESM)
//   public/test-page.js    the test page
// Run:  npm run build:client      (npm run dev and npm start do this for you)

import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const common = { bundle: true, format: 'esm', target: 'es2022', sourcemap: true, logLevel: 'info' };

await mkdir(path.join(root, 'dist'), { recursive: true });
await build({ ...common, entryPoints: [path.join(root, 'src/client/index.ts')], outfile: path.join(root, 'dist/icarus-voice.js') });
await build({ ...common, entryPoints: [path.join(root, 'public/test-page.ts')], outfile: path.join(root, 'public/test-page.js') });
// The test page can also load the module by URL.
await cp(path.join(root, 'dist/icarus-voice.js'), path.join(root, 'public/icarus-voice.js'));
