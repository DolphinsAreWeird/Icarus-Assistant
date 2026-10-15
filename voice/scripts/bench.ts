// Measure the pipeline speed with no microphone:   npm run bench
//   npm run bench -- --runs 5 --lang th
// Uses credits: a few seconds of speech-to-text and about 100 characters of text-to-speech per run.

import { createElevenLabsPort } from '../src/server/elevenlabs';
import { loadConfig } from '../src/server/env';
import { runBench, summarize } from '../src/server/bench';
import type { Lang } from '../src/shared/types';

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const runs = Number(arg('runs') ?? 3);
if (!Number.isInteger(runs) || runs < 1) {
  console.error('--runs must be a whole number, 1 or more.');
  process.exit(1);
}
const langs: Lang[] = arg('lang') === 'th' ? ['th'] : arg('lang') === 'en' ? ['en'] : ['en', 'th'];

const cfg = loadConfig();
if (!cfg.apiKey) {
  console.error('ELEVENLABS_API_KEY is not set. Copy .env.example to .env and add it.');
  process.exit(1);
}
const usable = langs.filter((l) => (l === 'th' ? cfg.voiceIdTh : cfg.voiceIdEn));
if (usable.length === 0) {
  console.error('No voice IDs set (VOICE_ID_EN / VOICE_ID_TH).');
  process.exit(1);
}

console.log(`Bench: ${runs} run(s) per language: ${usable.join(', ')}. The assistant is ${cfg.assistantMode === 'mock' ? `the mock (${cfg.mockDelayMs} ms simulated)` : 'the mock (bench always uses the mock)'}.`);
const results = await runBench({ cfg, port: createElevenLabsPort(cfg), langs: usable, runs });
console.log(`\n${summarize(results)}`);
console.log('\nThis is the server-side time. In the browser add about 40 ms of audio start lead, the audio device delay, and two local hops.');
