// Measure the pipeline speed with no microphone:   npm run bench
//   npm run bench -- --runs 5 --lang th
//   npm run bench -- --say          the pretend user is spoken by the macOS `say` command
//                                   (no TTS credits, and works while ElevenLabs TTS is unavailable)
// Uses credits: a few seconds of speech-to-text per run. Without --say also about 100 characters of TTS.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
const useSay = args.includes('--say');
const langs: Lang[] = arg('lang') === 'th' ? ['th'] : arg('lang') === 'en' ? ['en'] : ['en', 'th'];

const cfg = loadConfig();
if (!cfg.apiKey) {
  console.error('ELEVENLABS_API_KEY is not set. Copy .env.example to .env and add it.');
  process.exit(1);
}

/** The macOS `say` command, converted to 16 kHz mono 16-bit PCM with ffmpeg. */
function sayToPcm(text: string, voice: string): Buffer {
  const dir = mkdtempSync(path.join(tmpdir(), 'icarus-say-'));
  try {
    const aiff = path.join(dir, 'speech.aiff');
    execFileSync('say', ['-v', voice, '-o', aiff, text]);
    return execFileSync('ffmpeg', ['-v', 'error', '-i', aiff, '-f', 's16le', '-ar', '16000', '-ac', '1', '-'], { maxBuffer: 64 * 1024 * 1024 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SAY_VOICES: Record<Lang, string> = { en: 'Samantha', th: 'Kanya' };
const UTTERANCES: Record<Lang, string> = { en: 'Take me to gold.', th: 'พาไปที่ทอง' };

let usable = langs;
const utteranceAudio: Partial<Record<Lang, Buffer>> = {};
if (useSay) {
  for (const lang of langs) {
    try {
      utteranceAudio[lang] = sayToPcm(UTTERANCES[lang], SAY_VOICES[lang]);
    } catch (err) {
      console.error(`Could not make ${lang} audio with say/ffmpeg (${SAY_VOICES[lang]}): ${(err as Error).message.split('\n')[0]}`);
      usable = usable.filter((l) => l !== lang);
    }
  }
} else {
  usable = langs.filter((l) => (l === 'th' ? cfg.voiceIdTh : cfg.voiceIdEn));
  if (usable.length === 0) {
    console.error('No voice IDs set (VOICE_ID_EN / VOICE_ID_TH). Set them, or use --say to test speech-to-text alone.');
    process.exit(1);
  }
}
if (usable.length === 0) process.exit(1);

console.log(`Bench: ${runs} run(s) per language: ${usable.join(', ')}. Assistant: the mock (${cfg.mockDelayMs} ms simulated). The pretend user: ${useSay ? 'macOS say' : 'ElevenLabs TTS'}.`);
const results = await runBench({ cfg, port: createElevenLabsPort(cfg), langs: usable, runs, utterances: UTTERANCES, utteranceAudio });
console.log(`\n${summarize(results)}`);
console.log('\nThis is the server-side time. In the browser add about 40 ms of audio start lead, the audio device delay, and two local hops.');
