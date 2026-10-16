// Cross-platform `FAKE_ELEVENLABS=1 npm run dev`. Stays in front of the dev server: forwards stop signals
// to it and exits with its exit code.
import { runNpmAsync } from './lib/npm.mjs';

const env = { ...process.env, FAKE_ELEVENLABS: '1' };
const { code, message } = await runNpmAsync(['run', 'dev'], { env }, 'dev:fake');
if (message) console.error(message);
process.exit(code);
