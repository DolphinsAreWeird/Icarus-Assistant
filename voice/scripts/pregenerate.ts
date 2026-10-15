// Make the demo audio:   npm run pregenerate
//   npm run pregenerate -- --lang th      only Thai lines
//   npm run pregenerate -- --dry          list the lines and the credit cost, call nothing
//   npm run pregenerate -- --clean        delete old audio in demo-audio/ first

import { DEMO_LINES } from '../src/config/demo-lines';
import { createElevenLabsPort } from '../src/server/elevenlabs';
import { loadConfig } from '../src/server/env';
import { pregenerate } from '../src/server/pregenerate';
import { TtsCache } from '../src/server/tts-cache';
import { TtsService } from '../src/server/tts';
import { UsageTracker } from '../src/server/usage';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const langIndex = args.indexOf('--lang');
const langArg = langIndex >= 0 ? args[langIndex + 1] : undefined;

const cfg = loadConfig();
const lines = DEMO_LINES.filter((l) => !langArg || langArg === 'all' || l.lang === langArg);

if (lines.length === 0) {
  console.log('No demo lines for that language yet. Add Thai lines to src/config/demo-lines.ts after the Thai review.');
  process.exit(0);
}

const chars = lines.reduce((n, l) => n + l.text.length, 0);
console.log(`\n${lines.length} line(s), ${chars} characters.`);
console.log(`Output folder: ${cfg.demoAudioDir}`);
if (flag('dry')) {
  for (const l of lines) console.log(`  [${l.lang}] ${l.id}: ${l.text}`);
  console.log('\nDry run. Nothing was generated.');
  process.exit(0);
}
if (!cfg.apiKey) {
  console.error('\nELEVENLABS_API_KEY is not set. Copy .env.example to .env and add it.');
  process.exit(1);
}

const usage = new UsageTracker(() => undefined);
// Read and write the SAME folder, so lines that already exist are not generated (or paid for) again.
const cache = new TtsCache([cfg.demoAudioDir], cfg.demoAudioDir);
const tts = new TtsService(cfg, createElevenLabsPort(cfg), cache, usage, (l) => console.log(l));

const result = await pregenerate({ lines, tts, cfg, outDir: cfg.demoAudioDir, clean: flag('clean') });
console.log(`\nDone. Generated ${result.generated}, already cached ${result.alreadyCached}. Credits used: ${result.charactersUsed} characters.`);
console.log('Open the .wav files in demo-audio/ to listen, then commit the folder so the whole team has the audio.');
