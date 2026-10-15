// Make the demo audio:   npm run pregenerate
//   npm run pregenerate -- --lang th      only Thai lines
//   npm run pregenerate -- --dry          list the lines and the credit cost, call nothing
//   npm run pregenerate -- --clean        delete old audio in demo-audio/ first
//   npm run pregenerate -- --verify       then play every clip into the live Scribe and check the words AND the
//                                         numbers (a few seconds of speech-to-text per line). Fails if an amount is wrong.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DEMO_LINES } from '../src/config/demo-lines';
import { createElevenLabsPort } from '../src/server/elevenlabs';
import { loadConfig } from '../src/server/env';
import { pregenerate, type ManifestEntry } from '../src/server/pregenerate';
import { checkSpoken, resamplePcm16, type SpokenCheck } from '../src/server/transcribe';
import { TtsCache } from '../src/server/tts-cache';
import { TtsService } from '../src/server/tts';
import { UsageTracker } from '../src/server/usage';
import type { Lang } from '../src/shared/types';

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
const port = createElevenLabsPort(cfg);
const tts = new TtsService(cfg, port, cache, usage, (l) => console.log(l));

const result = await pregenerate({ lines, tts, cfg, outDir: cfg.demoAudioDir, clean: flag('clean') });
console.log(`\nDone. Generated ${result.generated}, already cached ${result.alreadyCached}. Credits used: ${result.charactersUsed} characters.`);
console.log('Open the .wav files in demo-audio/ to listen, then commit the folder so the whole team has the audio.');

if (flag('verify') && !(await verify(result.entries))) process.exit(1);

/** Play each clip into the live Scribe. False if any amount came back wrong or a check could not run. */
async function verify(entries: ManifestEntry[]): Promise<boolean> {
  console.log(`\nChecking ${entries.length} clip(s) with the live Scribe (real time, four at once)...`);
  const results: (SpokenCheck | undefined)[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < entries.length) {
        const i = next++;
        const e = entries[i] as ManifestEntry;
        const wav = await readFile(path.join(cfg.demoAudioDir, e.wav));
        try {
          results[i] = await checkSpoken(port, cfg, resamplePcm16(wav.subarray(44), e.sampleRate, 16000), e.lang as Lang, e.text);
        } catch (err) {
          console.log(`  could not check ${e.id}: ${(err as Error).message}`);
        }
      }
    }),
  );
  let ok = true;
  entries.forEach((e, i) => {
    const r = results[i];
    if (!r) {
      ok = false;
      return;
    }
    if (r.numbersRight === false) ok = false;
    const numbers = r.numbersRight === undefined ? '' : r.numbersRight ? ', numbers right' : ', NUMBERS WRONG';
    console.log(`  ${r.match >= 0.9 && r.numbersRight !== false ? 'OK  ' : 'LOOK'}  ${e.id.padEnd(12)} ${Math.round(r.match * 100)}% understood${numbers}`);
    if (r.match < 0.9 || r.numbersRight === false) console.log(`        said : ${e.text}\n        heard: ${r.heard}`);
  });
  console.log(ok ? '\nEvery clip checked, every amount right.' : '\nSomething needs a look (see above). Regenerate a wrong clip with --clean, or change the line.');
  return ok;
}
