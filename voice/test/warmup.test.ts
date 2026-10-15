import { describe, expect, it, vi } from 'vitest';
import type { ElevenLabsPort, SpeechArgs } from '../src/server/elevenlabs';
import { UsageTracker } from '../src/server/usage';
import { startVoiceWarmup, warmVoices } from '../src/server/warmup';
import { makeConfig } from './helpers';

function portThat(behave: (args: SpeechArgs) => 'ok' | 'fail') {
  const calls: SpeechArgs[] = [];
  const port: ElevenLabsPort = {
    async streamSpeech(args) {
      calls.push(args);
      if (behave(args) === 'fail') throw Object.assign(new Error('boom'), { statusCode: 500 });
      return new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array(480));
          c.close();
        },
      });
    },
    async createRealtimeToken() {
      return 'token';
    },
  };
  return { port, calls };
}

describe('voice warm-up', () => {
  it('says one short word in each voice, with the first model for that language, and counts the characters', async () => {
    const cfg = makeConfig({ VOICE_ID_EN: 'voice-en', VOICE_ID_TH: 'voice-th' });
    const { port, calls } = portThat(() => 'ok');
    const usage = new UsageTracker(() => undefined);
    const result = await warmVoices(port, cfg, usage, () => undefined);
    expect(calls.map((c) => [c.voiceId, c.modelId, c.languageCode])).toEqual([
      ['voice-en', 'eleven_flash_v2_5', undefined],
      ['voice-th', 'eleven_v4_turbo', 'th'],
    ]);
    expect(calls.every((c) => c.text.length <= 6)).toBe(true);
    expect(typeof result.en).toBe('number');
    expect(typeof result.th).toBe('number');
    expect(usage.addTts('warmup', 0, false).ttsCharacters).toBe('Hi.'.length + 'สวัสดี'.length);
  });

  it('never throws: a failing voice is logged and the other one still warms', async () => {
    const cfg = makeConfig({ VOICE_ID_EN: 'voice-en', VOICE_ID_TH: 'voice-th' });
    const { port } = portThat((a) => (a.voiceId === 'voice-en' ? 'fail' : 'ok'));
    const lines: string[] = [];
    const result = await warmVoices(port, cfg, new UsageTracker(() => undefined), (l) => lines.push(l));
    expect(result.en).toBeNull();
    expect(typeof result.th).toBe('number');
    expect(lines.join('\n')).toContain('Voice warm-up (en) failed');
  });

  it('skips a language with no voice, and does nothing at all when switched off', async () => {
    const { port, calls } = portThat(() => 'ok');
    await warmVoices(port, makeConfig({ VOICE_ID_EN: 'voice-en', VOICE_ID_TH: '' }), new UsageTracker(() => undefined), () => undefined);
    expect(calls.map((c) => c.voiceId)).toEqual(['voice-en']);
    const off = portThat(() => 'ok');
    startVoiceWarmup(off.port, makeConfig({ VOICE_ID_EN: 'voice-en', TTS_WARMUP_MINUTES: '0' }), new UsageTracker(() => undefined), () => undefined)();
    expect(off.calls).toHaveLength(0);
  });

  it('warms again on a timer', async () => {
    vi.useFakeTimers();
    try {
      const { port, calls } = portThat(() => 'ok');
      const stop = startVoiceWarmup(port, makeConfig({ VOICE_ID_EN: 'voice-en', VOICE_ID_TH: '', TTS_WARMUP_MINUTES: '20' }), new UsageTracker(() => undefined), () => undefined);
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(20 * 60_000);
      expect(calls).toHaveLength(2);
      stop();
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
