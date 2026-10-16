// Builds the Icarus app (../frontend) so the voice server can serve it at /app/.
// If the frontend packages are not installed yet, say how, and carry on. The voice server works without it.

import { runNpm } from './lib/npm.mjs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend');
if (!existsSync(path.join(frontend, 'package.json'))) process.exit(0);
if (!existsSync(path.join(frontend, 'node_modules'))) {
  console.log('\n[app] The Icarus app is not built yet. To get it at /app/:  cd ../frontend && npm install && npm run build\n');
  process.exit(0);
}
const { code, message } = runNpm(['run', 'build'], { cwd: frontend, env: process.env }, 'app');
if (message) console.error(message);
process.exit(code);
