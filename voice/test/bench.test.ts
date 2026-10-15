// Checks the bench's own logic against the fake Scribe and fake TTS (no network, no credits).
// This does NOT measure ElevenLabs. It proves the script streams, times and reports correctly.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { runBench, summarize } from '../src/server/bench';
import { createFakeElevenLabsPort } from '../src/server/fake-elevenlabs';
import { attachFakeStt } from '../src/server/fake-stt';
import { makeConfig } from './helpers';

let server: Server;
afterEach(() => new Promise<void>((r) => { server?.closeAllConnections(); server?.close(() => r()); }));

describe('bench', () => {
  it('streams a pretend user, times the final transcript, and reports the total', async () => {
    server = createServer();
    attachFakeStt(server);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as AddressInfo).port;
    const cfg = makeConfig({ ELEVENLABS_WS_BASE_URL: `ws://127.0.0.1:${port}`, STT_VAD_SILENCE_SECS: '0.5' });
    const lines: string[] = [];

    const runs = await runBench({
      cfg,
      port: createFakeElevenLabsPort({ sampleRate: 16000, firstByteDelayMs: 30, chunkDelayMs: 0 }),
      langs: ['en'],
      runs: 1,
      preRollSec: 0.2,
      log: (l) => lines.push(l),
    });

    expect(runs).toHaveLength(1);
    const r = runs[0]!;
    expect(r.transcript).toBe("what's this red number"); // the fake's first scripted phrase
    expect(r.confidence).toBeCloseTo(Math.exp(-0.05), 3);
    // The fake commits after the configured silence (0.5 s), measured from the last speech sample.
    expect(r.sttFinalMs).toBeGreaterThanOrEqual(450);
    expect(r.sttFinalMs).toBeLessThan(1200);
    expect(r.ttsFirstByteMs).toBeGreaterThanOrEqual(25);
    expect(r.assistantMs).toBeGreaterThanOrEqual(cfg.mockDelayMs - 5);
    expect(r.totalToFirstAudioMs).toBe((r.sttFinalMs ?? 0) + r.assistantMs + (r.ttsFirstByteMs ?? 0));
    expect(r.ttsModel).toBe('eleven_flash_v2_5');
    expect(lines.join('\n')).toContain('stt-final');
    expect(summarize(runs)).toMatch(/EN: 1 run\(s\)\. stt-final median \d+ ms.*Median to first audio \d+ ms/);
  }, 20_000);

  it('summarize says NOT MET when slow and MET when fast', () => {
    const base = { lang: 'en' as const, text: '', tokenMs: 1, connectMs: 1, firstPartialMs: 1, transcript: 'x', confidence: 0.9, assistantMs: 100, ttsFirstByteMs: 200, ttsError: null, ttsModel: 'm' };
    expect(summarize([{ ...base, sttFinalMs: 800, totalToFirstAudioMs: 1100 }])).toContain('MET');
    expect(summarize([{ ...base, sttFinalMs: 800, totalToFirstAudioMs: 1100 }])).not.toContain('NOT MET');
    expect(summarize([{ ...base, sttFinalMs: 2000, totalToFirstAudioMs: 2300 }])).toContain('NOT MET');
  });

  it('still reports the speech-to-text numbers when text-to-speech is unavailable', async () => {
    server = createServer();
    attachFakeStt(server);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as AddressInfo).port;
    const cfg = makeConfig({ ELEVENLABS_WS_BASE_URL: `ws://127.0.0.1:${port}`, STT_VAD_SILENCE_SECS: '0.5' });
    // The user's audio is supplied, and every TTS call fails (like a blocked account).
    const tone = Buffer.alloc(16000 * 2); // 1 s at 16 kHz
    for (let i = 0; i < 16000; i++) tone.writeInt16LE(Math.round(Math.sin(i / 8) * 9000), i * 2);
    const blocked = { streamSpeech: async () => { throw Object.assign(new Error('Unusual activity has been detected'), { statusCode: 401 }); }, createRealtimeToken: async () => 'fake-token' };

    const runs = await runBench({ cfg, port: blocked, langs: ['en'], runs: 1, preRollSec: 0.2, utteranceAudio: { en: tone }, log: () => undefined });
    const r = runs[0]!;
    expect(r.transcript).toBe("what's this red number");
    expect(r.sttFinalMs).toBeGreaterThanOrEqual(450);
    expect(r.ttsFirstByteMs).toBeNull();
    expect(r.ttsError).toMatch(/Unusual activity/);
    expect(r.totalToFirstAudioMs).toBeNull();
    expect(summarize(runs)).toMatch(/TTS was unavailable/);
  }, 20_000);
});
