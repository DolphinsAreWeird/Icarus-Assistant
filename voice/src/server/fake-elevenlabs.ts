// FAKE ElevenLabs for working on the UI with no API key and no credits (FAKE_ELEVENLABS=1).
// It "speaks" a short tone whose pitch depends on the text. No real speech, no real STT.
// Also used by the tests.

import type { ElevenLabsPort, SpeechArgs } from './elevenlabs';

export interface FakeOptions {
  /** Delay before the first audio, to look like a network call. */
  firstByteDelayMs?: number;
  sampleRate?: number;
  /** Wait between 100 ms audio chunks. Default 25 (about 4x real time). Tests use 0. */
  chunkDelayMs?: number;
  /** Throw a rejection for these model ids (to test the model fallback). */
  rejectModels?: string[];
  /** Called for every request. Tests use it to count API calls. */
  onRequest?: (args: SpeechArgs) => void;
}

export function createFakeElevenLabsPort(opts: FakeOptions = {}): ElevenLabsPort {
  const sampleRate = opts.sampleRate ?? 24000;
  return {
    async streamSpeech(args, signal) {
      opts.onRequest?.(args);
      if (opts.rejectModels?.includes(args.modelId)) {
        throw Object.assign(new Error('fake: model rejected'), { statusCode: 422 });
      }
      await new Promise((r) => setTimeout(r, opts.firstByteDelayMs ?? 80));
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      // About 55 ms of audio per character, between 0.6 s and 8 s.
      const seconds = Math.min(8, Math.max(0.6, args.text.length * 0.055));
      const total = Math.floor(seconds * sampleRate);
      const pitch = 220 + (args.text.length % 7) * 40;
      const chunkSamples = Math.floor(sampleRate * 0.1);
      let written = 0;

      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (signal?.aborted) return controller.error(new DOMException('Aborted', 'AbortError'));
          if (written >= total) return controller.close();
          const n = Math.min(chunkSamples, total - written);
          const buf = new Int16Array(n);
          for (let i = 0; i < n; i++) {
            const t = (written + i) / sampleRate;
            const fade = Math.min(1, (total - written - i) / (sampleRate * 0.05), (written + i) / (sampleRate * 0.02));
            buf[i] = Math.round(Math.sin(2 * Math.PI * pitch * t) * 9000 * Math.max(0, fade));
          }
          written += n;
          controller.enqueue(new Uint8Array(buf.buffer));
          // Real TTS streams faster than real time. Pace this at about 4x.
          await new Promise((r) => setTimeout(r, opts.chunkDelayMs ?? 25));
        },
      });
    },
    async createRealtimeToken() {
      return 'fake-token';
    },
  };
}
