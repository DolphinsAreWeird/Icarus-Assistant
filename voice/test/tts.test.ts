import { describe, expect, it } from 'vitest';
import { cacheKey } from '../src/server/tts-cache';
import { TtsError } from '../src/server/tts';
import { collect, makeConfig, makeStack } from './helpers';
import { TtsCache } from '../src/server/tts-cache';
import { UsageTracker } from '../src/server/usage';
import { TtsService } from '../src/server/tts';
import type { ElevenLabsPort } from '../src/server/elevenlabs';

describe('TtsService', () => {
  it('streams audio on a miss, then serves the same line from cache with no API call', async () => {
    const { tts, requests, usage } = makeStack();
    const first = await tts.open({ text: 'Hello there.', lang: 'en', sessionId: 's1' });
    expect(first.cache).toBe('miss');
    const audio = await collect(first.chunks);
    expect(audio.byteLength).toBeGreaterThan(1000);
    expect(requests).toHaveLength(1);

    const second = await tts.open({ text: 'Hello there.', lang: 'en', sessionId: 's1' });
    expect(second.cache).toBe('hit');
    expect(second.ttfbMs).toBe(0);
    expect(Buffer.compare(Buffer.from(await collect(second.chunks)), Buffer.from(audio))).toBe(0);
    expect(requests).toHaveLength(1); // still one API call

    expect(usage.get('s1')).toEqual({ sttSeconds: 0, ttsCharacters: 12, ttsCharactersFromCache: 12 });
  });

  it('uses the English voice and Flash for English', async () => {
    const { tts, requests } = makeStack();
    await collect((await tts.open({ text: 'Hi.', lang: 'en', sessionId: 's' })).chunks);
    expect(requests[0]).toMatchObject({ voiceId: 'voice-en', modelId: 'eleven_flash_v2_5', outputFormat: 'pcm_24000' });
    expect(requests[0]?.languageCode).toBeUndefined();
  });

  it('uses the Thai voice and a Thai-capable model for Thai', async () => {
    const { tts, requests } = makeStack();
    await collect((await tts.open({ text: 'สวัสดี', lang: 'th', sessionId: 's' })).chunks);
    expect(requests[0]).toMatchObject({ voiceId: 'voice-th', modelId: 'eleven_v4_turbo', languageCode: 'th' });
  });

  it('falls back to the next model only when a model is rejected', async () => {
    const { tts, requests } = makeStack({}, { rejectModels: ['eleven_v4_turbo'] });
    const stream = await tts.open({ text: 'สวัสดี', lang: 'th', sessionId: 's' });
    expect(stream.model).toBe('eleven_v4');
    await collect(stream.chunks);
    expect(requests.map((r) => r.modelId)).toEqual(['eleven_v4_turbo', 'eleven_v4']);
  });

  it('fails with a clear error when every model is rejected', async () => {
    const { tts } = makeStack({ TTS_MODEL_TH: 'a,b' }, { rejectModels: ['a', 'b'] });
    await expect(tts.open({ text: 'สวัสดี', lang: 'th', sessionId: 's' })).rejects.toMatchObject({ code: 'tts_failed' });
  });

  it('does NOT cache audio that was cut short (barge-in)', async () => {
    const { tts, requests } = makeStack();
    const abort = new AbortController();
    const stream = await tts.open({ text: 'A fairly long sentence that takes a while to say out loud.', lang: 'en', sessionId: 's' }, abort.signal);
    const it = stream.chunks[Symbol.asyncIterator]();
    await it.next(); // first chunk plays...
    abort.abort(); // ...then the user interrupts
    await it.return?.(undefined);

    const again = await tts.open({ text: 'A fairly long sentence that takes a while to say out loud.', lang: 'en', sessionId: 's' });
    expect(again.cache).toBe('miss'); // nothing half-finished was saved
    await collect(again.chunks);
    expect(requests).toHaveLength(2);
  });

  it('keeps separate cache entries per voice, model, speed and text', () => {
    const base = { voiceId: 'v', model: 'm', speed: 1, outputFormat: 'pcm_24000', text: 'hello' };
    const keys = new Set([
      cacheKey(base),
      cacheKey({ ...base, voiceId: 'v2' }),
      cacheKey({ ...base, model: 'm2' }),
      cacheKey({ ...base, speed: 0.9 }),
      cacheKey({ ...base, text: 'hello.' }),
    ]);
    expect(keys.size).toBe(5);
  });

  it('rejects empty text, long text and a missing voice', async () => {
    const { tts } = makeStack({ TTS_MAX_CHARS: '20' });
    await expect(tts.open({ text: '  ', lang: 'en', sessionId: 's' })).rejects.toMatchObject({ code: 'empty_text' });
    await expect(tts.open({ text: 'x'.repeat(21), lang: 'en', sessionId: 's' })).rejects.toMatchObject({ code: 'too_long' });
    const noVoice = makeStack({ VOICE_ID_TH: '' });
    await expect(noVoice.tts.open({ text: 'สวัสดี', lang: 'th', sessionId: 's' })).rejects.toBeInstanceOf(TtsError);
  });
});

describe('TtsService error handling (what ElevenLabs really sends back)', () => {
  /** A port whose TTS call always fails like ElevenLabs does. */
  function failing(statusCode: number, body: unknown) {
    const calls: string[] = [];
    const port: ElevenLabsPort = {
      async streamSpeech(args) {
        calls.push(args.modelId);
        throw Object.assign(new Error('upstream'), { statusCode, body });
      },
      async createRealtimeToken() {
        return 't';
      },
    };
    const cfg = makeConfig();
    const tts = new TtsService(cfg, port, new TtsCache([cfg.cacheDir], cfg.cacheDir), new UsageTracker(() => undefined), () => undefined);
    return { tts, calls };
  }

  it('a wrong voice ID (400 invalid_uid) is reported clearly and does not cycle through models', async () => {
    const { tts, calls } = failing(400, { detail: { status: 'invalid_uid', message: "An invalid ID has been received for voice: 'x'." } });
    await expect(tts.open({ text: 'สวัสดี', lang: 'th', sessionId: 's' })).rejects.toMatchObject({
      code: 'bad_voice',
      message: expect.stringContaining('VOICE_ID_TH'),
    });
    expect(calls).toEqual(['eleven_v4_turbo']); // one call, no fallback
  });

  it('a bad API key (401) stops at once', async () => {
    const { tts, calls } = failing(401, { detail: { status: 'invalid_api_key', message: 'Invalid API key' } });
    await expect(tts.open({ text: 'สวัสดี', lang: 'th', sessionId: 's' })).rejects.toMatchObject({ code: 'tts_failed' });
    expect(calls).toEqual(['eleven_v4_turbo']);
  });

  it('a rate limit (429) stops at once too', async () => {
    const { tts, calls } = failing(429, { detail: { status: 'too_many_requests', message: 'slow down' } });
    await expect(tts.open({ text: 'สวัสดี', lang: 'th', sessionId: 's' })).rejects.toMatchObject({ code: 'tts_failed' });
    expect(calls).toHaveLength(1);
  });

  it('a model problem (400 unsupported model) does try the next model', async () => {
    const { tts, calls } = failing(400, { detail: { status: 'model_not_found', message: 'no such model' } });
    await expect(tts.open({ text: 'สวัสดี', lang: 'th', sessionId: 's' })).rejects.toMatchObject({ code: 'tts_failed' });
    expect(calls).toEqual(['eleven_v4_turbo', 'eleven_v4', 'eleven_v3']);
  });

  it('understands a body that arrives as a JSON string', async () => {
    const { tts, calls } = failing(400, JSON.stringify({ detail: { status: 'invalid_uid', message: 'voice' } }));
    await expect(tts.open({ text: 'hi there', lang: 'en', sessionId: 's' })).rejects.toMatchObject({ code: 'bad_voice' });
    expect(calls).toHaveLength(1);
  });
});

