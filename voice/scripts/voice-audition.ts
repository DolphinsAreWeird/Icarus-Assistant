// Audition the finalist voices with OUR lines:
//   npm run audition -- --add          OPTIONAL: add the library finalists to My Voices (needs a key with the voices_write
//                                      permission and uses voice slots). Not needed: library voices work by ID on paid plans.
//   npm run audition                   generate our lines in every finalist, measure them, check them with Scribe
//   npm run audition -- --only Callie,Aom
//   npm run audition -- --dry          show the lines and the credit cost, call nothing
//
// For every voice and line it saves a WAV to voice/auditions/<name>/ (git-ignored) so people can LISTEN, and measures:
//   - the real pitch of what it said (is it still high and cute?)
//   - time to first audio
//   - whether the live Scribe understands it (similarity between the text and what Scribe heard)
//   - whether the NUMBERS in it were said right (1,000 / 15 / 1,015 must come back as 1,000 / 15 / 1,015)
// A person, ideally a Thai speaker, still has to listen. Numbers cannot tell you whether a voice sounds nice.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { DEMO_LINES_EN } from '../src/config/demo-lines';
import { HANDOFF_COPY } from '../src/config/handoff';
import { MOCK_REPLIES } from '../src/config/mock-replies';
import { CUTE_FINALISTS, type VoiceCandidate } from '../src/config/voice-candidates';
import { createElevenLabsPort, isBadVoice, isModelRejection, upstreamInfo } from '../src/server/elevenlabs';
import { VOICE_ROOT, loadConfig } from '../src/server/env';
import { pcmToWav } from '../src/server/pregenerate';
import { checkSpoken, resamplePcm16 } from '../src/server/transcribe';
import { buildReadback } from '../src/shared/readback';
import { toSpeakable } from '../src/shared/speech-format';
import type { Lang, TradePreview } from '../src/shared/types';
import { estimatePitch } from './voice-scout';

const GOLD: TradePreview = { preview_id: 'x', side: 'buy', asset: 'gold', amount: 1000, fee: 15, total: 1015, currency: 'THB' };
const spoken = (text: string, lang: Lang) => toSpeakable(text, { lang, exact: true, shorten: false });
const demo = (id: string) => DEMO_LINES_EN.find((l) => l.id === id)?.text ?? '';

interface Line {
  id: string;
  text: string;
}

const LINES: Record<Lang, Line[]> = {
  en: [
    { id: 'greeting', text: spoken(demo('greeting'), 'en') },
    { id: 'explain', text: spoken(demo('explain'), 'en') },
    { id: 'readback', text: buildReadback(GOLD, 'en') },
    { id: 'handoff', text: spoken(HANDOFF_COPY.en.messages.commerce, 'en') },
  ],
  th: [
    // THAI REVIEW: the greeting is a draft.
    { id: 'greeting', text: 'สวัสดี ฉันชื่ออิคารัส ถามฉันเรื่องอะไรก็ได้บนหน้าจอของคุณ' },
    { id: 'explain', text: spoken(MOCK_REPLIES.th.explain, 'th') },
    { id: 'readback', text: buildReadback(GOLD, 'th') },
    { id: 'handoff', text: spoken(HANDOFF_COPY.th.messages.commerce, 'th') },
  ],
};

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = arg('only')?.split(',').map((s) => s.trim().toLowerCase());
const finalists = CUTE_FINALISTS.filter((c) => !only || only.includes(c.name.toLowerCase()));

const cfg = loadConfig();

async function addVoices(client: ElevenLabsClient): Promise<void> {
  const mine = new Set(((await client.voices.search({ pageSize: 100 })).voices ?? []).map((v) => v.voiceId));
  for (const c of finalists) {
    if (c.source === 'premade' || mine.has(c.voiceId)) {
      console.log(`  ${c.name.padEnd(9)} already on the account`);
      continue;
    }
    try {
      const found = ((await client.voices.getShared({ language: c.lang, search: c.name, pageSize: 30 })).voices ?? []).find((v) => v.voiceId === c.voiceId);
      if (!found) {
        console.log(`  ${c.name.padEnd(9)} NOT FOUND in the library (it may have been removed)`);
        continue;
      }
      const added = await client.voices.share(found.publicOwnerId, c.voiceId, { newName: found.name });
      console.log(`  ${c.name.padEnd(9)} added (${added.voiceId})${added.voiceId === c.voiceId ? '' : '  NOTE: the account got a different ID, update voice-candidates.ts'}`);
    } catch (err) {
      console.log(`  ${c.name.padEnd(9)} could not be added: ${upstreamInfo(err).message}`);
      console.log('  (Fine. Library voices can be used by ID without adding them. Skipping the rest.)');
      return;
    }
  }
}

interface Clip {
  candidate: VoiceCandidate;
  line: Line;
  pcm24: Buffer;
  pcm16: Uint8Array;
  ttfbMs: number;
  model: string;
  pitchHz: number | null;
  heard?: string;
  match?: number;
  /** undefined when the line has no numbers. */
  numbersRight?: boolean;
}

async function synthesise(c: VoiceCandidate, line: Line, port: ReturnType<typeof createElevenLabsPort>): Promise<Clip> {
  const models = c.lang === 'th' ? cfg.ttsModelsTh : cfg.ttsModelsEn;
  let lastError: unknown;
  for (const model of models) {
    const started = performance.now();
    try {
      const body = await port.streamSpeech({ voiceId: c.voiceId, text: line.text, modelId: model, outputFormat: 'pcm_24000', ...(c.lang === 'th' ? { languageCode: 'th' } : {}) });
      const reader = body.getReader();
      const parts: Uint8Array[] = [];
      let ttfbMs = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (parts.length === 0 && !done) ttfbMs = Math.round(performance.now() - started);
        if (done) break;
        parts.push(value);
      }
      const pcm24 = Buffer.concat(parts);
      const pcm16 = resamplePcm16(pcm24, 24000, 16000);
      const pitch = estimatePitch(new Int16Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength >> 1));
      return { candidate: c, line, pcm24, pcm16, ttfbMs, model, pitchHz: pitch ? Math.round(pitch.median) : null };
    } catch (err) {
      lastError = err;
      if (isBadVoice(err)) throw new Error(`${c.name}: ElevenLabs does not know this voice yet. Run: npm run audition -- --add`);
      if (!isModelRejection(err)) break;
    }
  }
  throw new Error(`${c.name}/${line.id}: ${upstreamInfo(lastError).message}`);
}

async function main() {
  const totalChars = finalists.reduce((n, c) => n + LINES[c.lang].reduce((m, l) => m + l.text.length, 0), 0);
  if (args.includes('--dry')) {
    for (const c of finalists) for (const l of LINES[c.lang]) console.log(`[${c.name}] ${l.id}: ${l.text}`);
    console.log(`\n${finalists.length} voices, about ${totalChars} characters of text-to-speech. Nothing was generated.`);
    return;
  }
  if (!cfg.apiKey) {
    console.error('ELEVENLABS_API_KEY is not set.');
    process.exit(1);
  }
  const client = new ElevenLabsClient({ apiKey: cfg.apiKey, ...(cfg.restBaseUrl ? { baseUrl: cfg.restBaseUrl } : {}) });
  const port = createElevenLabsPort(cfg);

  if (args.includes('--add')) {
    console.log('Adding the finalists to the account:');
    await addVoices(client);
    if (!args.includes('--and-audition')) return;
  }

  console.log(`Auditioning ${finalists.length} voices, about ${totalChars} characters of text-to-speech.\n`);
  const outDir = path.join(VOICE_ROOT, 'auditions');
  const clips: Clip[] = [];
  for (const c of finalists) {
    for (const line of LINES[c.lang]) {
      const clip = await synthesise(c, line, port);
      clips.push(clip);
      const dir = path.join(outDir, c.name.toLowerCase());
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `${line.id}.${c.lang}.wav`), pcmToWav(clip.pcm24, 24000));
    }
    console.log(`  made ${c.name}`);
  }

  // Ask Scribe about the clips, four at a time.
  const toCheck = clips;
  console.log(`\nChecking ${toCheck.length} clips with Scribe (real time, four at once)...`);
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < toCheck.length) {
        const clip = toCheck[next++] as Clip;
        try {
          const result = await checkSpoken(port, cfg, clip.pcm16, clip.candidate.lang, clip.line.text);
          clip.heard = result.heard;
          clip.match = result.match;
          clip.numbersRight = result.numbersRight;
        } catch (err) {
          clip.heard = `(check failed: ${(err as Error).message})`;
        }
      }
    }),
  );

  // Summary per voice
  const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
  const rows = finalists.map((c) => {
    const mine = clips.filter((x) => x.candidate === c);
    const hz = median(mine.map((x) => x.pitchHz).filter((x): x is number => x !== null));
    const matches = mine.map((x) => x.match).filter((x): x is number => x !== undefined);
    return {
      name: c.name,
      lang: c.lang,
      sampleHz: c.sampleHz,
      saidHz: hz,
      coldMs: mine[0]?.ttfbMs ?? 0,
      warmMs: median(mine.slice(1).map((x) => x.ttfbMs)) ?? 0,
      numbers: mine.some((x) => x.numbersRight === false) ? `WRONG in ${mine.filter((x) => x.numbersRight === false).map((x) => x.line.id).join(', ')}` : mine.some((x) => x.numbersRight) ? 'all right' : 'n/a',
      understoodMin: matches.length ? Math.min(...matches) : null,
      understoodAvg: matches.length ? matches.reduce((a, b) => a + b, 0) / matches.length : null,
      model: mine[0]?.model ?? '',
      chars: LINES[c.lang].reduce((n, l) => n + l.text.length, 0),
    };
  });
  console.log('\nVOICE      LANG  SAMPLE   SAID     FIRST AUDIO (1st / later)  UNDERSTOOD (worst / avg)  NUMBERS      MODEL');
  for (const r of rows) {
    console.log(
      `${r.name.padEnd(10)} ${r.lang.padEnd(5)} ${`${r.sampleHz} Hz`.padEnd(8)} ${(r.saidHz === null ? '?' : `${r.saidHz} Hz`).padEnd(8)} ${`${r.coldMs} / ${r.warmMs} ms`.padEnd(26)} ${(r.understoodMin === null ? 'n/a' : `${Math.round(r.understoodMin * 100)}% / ${Math.round((r.understoodAvg ?? 0) * 100)}%`).padEnd(25)} ${r.numbers.padEnd(12)} ${r.model}`,
    );
  }
  console.log('\nWhat Scribe heard, where it was not a near-perfect match (under 90%):');
  for (const c of toCheck.filter((x) => (x.match ?? 1) < 0.9)) console.log(`  ${c.candidate.name}/${c.line.id} (${Math.round((c.match ?? 0) * 100)}%)\n    said : ${c.line.text}\n    heard: ${c.heard}`);

  await writeFile(path.join(outDir, 'summary.json'), JSON.stringify({ when: new Date().toISOString(), rows, heard: toCheck.map((c) => ({ voice: c.candidate.name, line: c.line.id, said: c.line.text, heard: c.heard, match: c.match, numbersRight: c.numbersRight })) }, null, 2));
  console.log(`\nListen to the WAV files in ${outDir}`);
}

void main().catch((err) => {
  console.error(`\n${(err as Error).message}`);
  process.exit(1);
});
