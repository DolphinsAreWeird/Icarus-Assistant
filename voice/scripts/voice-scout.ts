// Find a voice for Icarus:   npm run voices
//   npm run voices -- --library --lang th          also search the public Voice Library for Thai voices
//   npm run voices -- --library --lang th --limit 60
//   npm run voices -- --min 240                    only voices whose pitch is at least this many Hz
//   npm run voices -- --library --lang en --gender female --age young --descriptive cute
//   npm run voices -- --library --lang en --gender male --descriptive professional
//   npm run voices -- --library --lang th --wide   full names and descriptions
//
// For every voice it downloads the free sample ElevenLabs publishes (no credits used), measures the
// real pitch (the median fundamental frequency, in Hz) and prints a table with a link to listen.
// Pitch is a guide, not a verdict: "cute" is also about style. A person has to listen.
//
// Rough guide for speech: male voices sit around 85 to 155 Hz, female around 165 to 255 Hz,
// and a high, bright, cute voice is usually 230 Hz or more.

import { execFileSync } from 'node:child_process';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { loadConfig } from '../src/server/env';

interface Candidate {
  source: 'account' | 'library';
  name: string;
  voiceId: string;
  gender: string;
  age: string;
  style: string;
  language: string;
  description?: string | undefined;
  previewUrl: string | undefined;
  /** Library only. Whether a free-plan account may use it through the API. */
  freeOk?: boolean;
  usage7d?: number;
  /** Library only: needed to add the voice to the account. */
  publicOwnerId?: string;
}

/** Median pitch of speech in a 16 kHz mono 16-bit recording. Autocorrelation on voiced frames. */
export function estimatePitch(pcm: Int16Array, rate = 16000): { median: number; p10: number; p90: number; frames: number } | null {
  const frame = Math.round(rate * 0.04);
  const hop = Math.round(rate * 0.02);
  const minLag = Math.round(rate / 450);
  const maxLag = Math.round(rate / 70);
  const rms = (start: number) => {
    let s = 0;
    for (let i = start; i < start + frame; i++) s += (pcm[i] as number) ** 2;
    return Math.sqrt(s / frame);
  };
  let peak = 0;
  for (let i = 0; i + frame <= pcm.length; i += hop) peak = Math.max(peak, rms(i));
  if (peak === 0) return null;

  const pitches: number[] = [];
  for (let start = 0; start + frame + maxLag <= pcm.length; start += hop) {
    if (rms(start) < peak * 0.12) continue; // silence
    let r0 = 0;
    for (let i = 0; i < frame; i++) r0 += (pcm[start + i] as number) ** 2;
    let best = 0;
    let bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let r = 0;
      for (let i = 0; i < frame; i++) r += (pcm[start + i] as number) * (pcm[start + i + lag] as number);
      const normalised = r / r0;
      if (normalised > best) {
        best = normalised;
        bestLag = lag;
      }
    }
    if (best >= 0.55 && bestLag > 0) pitches.push(rate / bestLag); // clearly voiced
  }
  if (pitches.length < 8) return null;
  pitches.sort((a, b) => a - b);
  const at = (q: number) => pitches[Math.min(pitches.length - 1, Math.floor(q * pitches.length))] as number;
  return { median: at(0.5), p10: at(0.1), p90: at(0.9), frames: pitches.length };
}

async function measure(url: string): Promise<ReturnType<typeof estimatePitch>> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const audio = Buffer.from(await res.arrayBuffer());
    const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 's16le', '-ar', '16000', '-ac', '1', '-'], { input: audio, maxBuffer: 64 << 20 });
    return estimatePitch(new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2)));
  } catch {
    return null;
  }
}

const band = (hz: number) => (hz < 130 ? 'low' : hz < 180 ? 'mid-low' : hz < 230 ? 'mid' : hz < 300 ? 'HIGH' : 'VERY HIGH');

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const cfg = loadConfig();
  if (!cfg.apiKey) {
    console.error('ELEVENLABS_API_KEY is not set. Add it to .env.');
    process.exit(1);
  }
  const client = new ElevenLabsClient({ apiKey: cfg.apiKey, ...(cfg.restBaseUrl ? { baseUrl: cfg.restBaseUrl } : {}) });
  const lang = arg('lang') ?? 'th';
  const limit = Number(arg('limit') ?? 40);
  const minHz = Number(arg('min') ?? 0);

  const candidates: Candidate[] = [];
  try {
    const mine = await client.voices.search({ pageSize: 100 });
    for (const v of mine.voices ?? []) {
      candidates.push({
        source: 'account', name: String(v.name).split(' - ')[0] ?? String(v.name), voiceId: v.voiceId,
        gender: v.labels?.gender ?? '?', age: v.labels?.age ?? '?', style: [v.labels?.descriptive, v.labels?.use_case].filter(Boolean).join(', '),
        language: v.labels?.language ?? '?', previewUrl: v.previewUrl,
      });
    }
  } catch (err) {
    console.error(`Could not list the account's voices: ${(err as Error).message.split('\n')[0]}`);
  }

  if (args.includes('--library')) {
    try {
      const lib = await client.voices.getShared({
        language: lang,
        pageSize: Math.min(100, limit),
        sort: 'trending',
        ...(arg('gender') ? { gender: arg('gender') as string } : {}),
        ...(arg('age') ? { age: arg('age') as string } : {}),
        ...(arg('descriptive') ? { descriptives: arg('descriptive') as string } : {}),
        ...(arg('use-case') ? { useCases: arg('use-case') as string } : {}),
        ...(arg('search') ? { search: arg('search') as string } : {}),
      });
      for (const v of lib.voices ?? []) {
        candidates.push({
          source: 'library', name: v.name, voiceId: v.voiceId, gender: v.gender, age: v.age,
          style: [v.descriptive, v.useCase].filter(Boolean).join(', '), language: v.language ?? lang, previewUrl: v.previewUrl,
          freeOk: v.freeUsersAllowed, usage7d: v.usageCharacterCount7D, publicOwnerId: v.publicOwnerId, description: v.description,
        });
      }
    } catch (err) {
      console.error(`Could not search the voice library: ${(err as Error).message.split('\n')[0]}`);
    }
  }

  console.log(`\nMeasuring the pitch of ${candidates.length} voices from their free samples...\n`);
  const rows: Array<Candidate & { hz: number | null; spread: string }> = [];
  for (const c of candidates) {
    const m = c.previewUrl ? await measure(c.previewUrl) : null;
    rows.push({ ...c, hz: m ? Math.round(m.median) : null, spread: m ? `${Math.round(m.p10)}-${Math.round(m.p90)}` : '' });
  }
  rows.sort((a, b) => (b.hz ?? 0) - (a.hz ?? 0));

  const line = (r: (typeof rows)[number]) =>
    `${(r.hz === null ? '?' : `${r.hz} Hz`).padEnd(8)} ${(r.hz === null ? '' : band(r.hz)).padEnd(9)} ${r.source.padEnd(8)} ${r.name.slice(0, 26).padEnd(27)} ${r.gender.padEnd(7)} ${r.age.padEnd(12)} ${r.style.slice(0, 38).padEnd(39)}${r.freeOk === undefined ? '' : r.freeOk ? 'free-ok ' : 'PAID    '}${r.voiceId}`;
  console.log('PITCH    BAND      WHERE    NAME                        GENDER  AGE          STYLE                                   ID');
  for (const r of rows) if ((r.hz ?? 0) >= minHz) console.log(line(r));
  if (args.includes('--wide')) {
    console.log('\nFULL DETAILS');
    for (const r of rows.filter((x) => (x.hz ?? 0) >= minHz)) console.log(`  ${r.name} | ${r.source} | ${r.gender}, ${r.age} | ${r.style}\n    ${(r.description ?? '').slice(0, 220)}`);
  }
  console.log('\nListen (free): ');
  for (const r of rows.filter((x) => (x.hz ?? 0) >= minHz).slice(0, 25)) console.log(`  ${r.name.slice(0, 26).padEnd(27)} ${r.previewUrl ?? '(no sample)'}`);
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
