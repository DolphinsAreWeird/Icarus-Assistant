// Pre-generates the demo lines to audio files, so the demo costs credits only once and
// still works with no network. Used by `npm run pregenerate`.
//
// Files go to demo-audio/ (committed to git):
//   <hash>.pcm + <hash>.json   what the server's TTS cache reads. The hash covers voice,
//                              model, speed, format and text, so a changed voice means new files.
//   <id>.<lang>.wav            the same audio in a normal format, so anyone can listen
//   manifest.json              which line is which file

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DemoLine } from '../config/demo-lines';
import { toSpeakable } from '../shared/speech-format';
import type { ServerConfig } from './env';
import { cacheKey } from './tts-cache';
import type { TtsService } from './tts';

export interface ManifestEntry {
  id: string;
  lang: string;
  text: string;
  when: string;
  voiceId: string;
  model: string;
  sampleRate: number;
  bytes: number;
  seconds: number;
  cacheKey: string;
  wav: string;
  generatedNow: boolean;
}

export interface PregenerateResult {
  entries: ManifestEntry[];
  generated: number;
  alreadyCached: number;
  /** Characters sent to ElevenLabs. Cached lines cost nothing. */
  charactersUsed: number;
}

/** A 44-byte WAV header followed by the PCM, so any audio player can open the file. */
export function pcmToWav(pcm: Uint8Array, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, Buffer.from(pcm)]);
}

export async function pregenerate(opts: {
  lines: DemoLine[];
  tts: TtsService;
  cfg: ServerConfig;
  outDir: string;
  /** Delete old audio, wav and manifest files in outDir first. */
  clean?: boolean;
  log?: (line: string) => void;
}): Promise<PregenerateResult> {
  const { lines, tts, cfg, outDir } = opts;
  const log = opts.log ?? ((l: string) => console.log(l));
  await mkdir(outDir, { recursive: true });

  if (opts.clean) {
    for (const file of await readdir(outDir)) {
      if (/\.(pcm|json|wav)$/.test(file)) await rm(path.join(outDir, file));
    }
  }

  const entries: ManifestEntry[] = [];
  let generated = 0;
  let alreadyCached = 0;
  let charactersUsed = 0;

  for (const line of lines) {
    // Say it exactly as the app will: through the same cleanup, with exact numbers.
    const text = toSpeakable(line.text, { lang: line.lang, exact: true, shorten: false });
    if (text !== line.text) {
      log(`  note: "${line.id}" is spoken as "${text}" (it changes when cleaned up for speech)`);
    }
    const voiceId = tts.voiceFor(line.lang);
    if (!voiceId) throw new Error(`No voice for ${line.lang}. Set VOICE_ID_${line.lang.toUpperCase()} in .env`);

    const stream = await tts.open({ text, lang: line.lang, sessionId: 'pregenerate' });
    const parts: Uint8Array[] = [];
    for await (const chunk of stream.chunks) parts.push(chunk);
    const pcm = Buffer.concat(parts);

    const fresh = stream.cache === 'miss';
    if (fresh) {
      generated += 1;
      charactersUsed += text.length;
    } else alreadyCached += 1;

    const wavName = `${line.id}.${line.lang}.wav`;
    await writeFile(path.join(outDir, wavName), pcmToWav(pcm, stream.sampleRate));
    entries.push({
      id: line.id,
      lang: line.lang,
      text,
      when: line.when,
      voiceId,
      model: stream.model,
      sampleRate: stream.sampleRate,
      bytes: pcm.byteLength,
      seconds: Math.round((pcm.byteLength / 2 / stream.sampleRate) * 100) / 100,
      cacheKey: cacheKey({ voiceId, model: stream.model, speed: 1, outputFormat: cfg.ttsOutputFormat, text }),
      wav: wavName,
      generatedNow: fresh,
    });
    log(`  ${fresh ? 'generated' : 'already cached'}  ${line.id} (${line.lang}, ${stream.model}, ${entries.at(-1)?.seconds}s)`);
  }

  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify({ outputFormat: cfg.ttsOutputFormat, entries }, null, 2) + '\n');
  return { entries, generated, alreadyCached, charactersUsed };
}
