import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEMO_LINES_EN } from '../src/config/demo-lines';
import { pcmToWav, pregenerate } from '../src/server/pregenerate';
import { TtsCache } from '../src/server/tts-cache';
import { TtsService } from '../src/server/tts';
import { UsageTracker } from '../src/server/usage';
import { createFakeElevenLabsPort } from '../src/server/fake-elevenlabs';
import { makeConfig } from './helpers';

function setup() {
  const cfg = makeConfig();
  const calls: string[] = [];
  const port = createFakeElevenLabsPort({ firstByteDelayMs: 1, chunkDelayMs: 0, onRequest: (a) => calls.push(a.text) });
  const outDir = mkdtempSync(path.join(tmpdir(), 'icarus-demo-'));
  const cache = new TtsCache([outDir], outDir);
  const tts = new TtsService(cfg, port, cache, new UsageTracker(() => undefined), () => undefined);
  return { cfg, calls, outDir, tts };
}

describe('pregenerate', () => {
  it('makes audio, wav files and a manifest for every demo line', async () => {
    const { cfg, outDir, tts, calls } = setup();
    const res = await pregenerate({ lines: DEMO_LINES_EN, tts, cfg, outDir, log: () => undefined });
    expect(res.generated).toBe(DEMO_LINES_EN.length);
    expect(calls).toHaveLength(DEMO_LINES_EN.length);
    expect(res.charactersUsed).toBe(DEMO_LINES_EN.reduce((n, l) => n + l.text.length, 0));

    const files = readdirSync(outDir);
    for (const line of DEMO_LINES_EN) expect(files).toContain(`${line.id}.en.wav`);
    expect(files.filter((f) => f.endsWith('.pcm'))).toHaveLength(DEMO_LINES_EN.length);

    const manifest = JSON.parse(readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
    expect(manifest.entries).toHaveLength(DEMO_LINES_EN.length);
    expect(manifest.entries[0]).toMatchObject({ id: 'greeting', lang: 'en', model: 'eleven_flash_v2_5', voiceId: 'voice-en' });
  });

  it('does not pay twice: a second run uses the cache', async () => {
    const { cfg, outDir, tts, calls } = setup();
    await pregenerate({ lines: DEMO_LINES_EN, tts, cfg, outDir, log: () => undefined });
    const again = await pregenerate({ lines: DEMO_LINES_EN, tts, cfg, outDir, log: () => undefined });
    expect(again.generated).toBe(0);
    expect(again.alreadyCached).toBe(DEMO_LINES_EN.length);
    expect(again.charactersUsed).toBe(0);
    expect(calls).toHaveLength(DEMO_LINES_EN.length); // no new API calls
  });

  it('writes files the live server will hit (same cache key)', async () => {
    const { cfg, outDir, tts } = setup();
    await pregenerate({ lines: DEMO_LINES_EN, tts, cfg, outDir, log: () => undefined });
    // A server reading demo-audio/ finds the readback line with no API call.
    const server = makeConfig({ DEMO_AUDIO_DIR: outDir });
    const calls: string[] = [];
    const serverTts = new TtsService(server, createFakeElevenLabsPort({ chunkDelayMs: 0, onRequest: (a) => calls.push(a.text) }), new TtsCache([server.cacheDir, outDir], server.cacheDir), new UsageTracker(() => undefined));
    const stream = await serverTts.open({ text: '1,000 baht into gold. Fee 15 baht. Total 1,015 baht. Say confirm or cancel.', lang: 'en', sessionId: 's' });
    expect(stream.cache).toBe('hit');
    expect(calls).toHaveLength(0);
  });

  it('--clean removes old audio but nothing else', async () => {
    const { cfg, outDir, tts } = setup();
    await pregenerate({ lines: DEMO_LINES_EN.slice(0, 1), tts, cfg, outDir, log: () => undefined });
    await pregenerate({ lines: DEMO_LINES_EN.slice(1, 2), tts, cfg, outDir, clean: true, log: () => undefined });
    expect(readdirSync(outDir).filter((f) => f.endsWith('.wav'))).toEqual(['explain.en.wav']);
  });

  it('fails clearly when a voice is missing', async () => {
    const cfg = makeConfig({ VOICE_ID_EN: '' });
    const outDir = mkdtempSync(path.join(tmpdir(), 'icarus-demo-'));
    const tts = new TtsService(cfg, createFakeElevenLabsPort(), new TtsCache([outDir], outDir), new UsageTracker(() => undefined));
    await expect(pregenerate({ lines: DEMO_LINES_EN, tts, cfg, outDir, log: () => undefined })).rejects.toThrow(/VOICE_ID_EN/);
  });
});

describe('pcmToWav', () => {
  it('writes a valid mono 16-bit header', () => {
    const wav = pcmToWav(new Uint8Array(480), 24000);
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.subarray(8, 12).toString()).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(480);
    expect(wav.length).toBe(44 + 480);
  });
});
