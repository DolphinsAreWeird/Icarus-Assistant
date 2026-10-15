// Text-to-speech service: picks the voice and model, checks the cache, streams audio.
//
// Model choice (ElevenLabs models page, checked Oct 2026):
//   English: eleven_flash_v2_5   about 75 ms. Does NOT support Thai.
//   Thai:    eleven_v4_turbo     about 100 ms. Supports Thai. Fallbacks: eleven_v4, eleven_v3.
//
// Cache rule: audio is saved only when the stream finished. A stream cut short by barge-in
// is never saved, so the cache never plays half a sentence.

import type { Lang } from '../shared/types';
import { isBadVoice, isModelRejection, upstreamInfo, type ElevenLabsPort } from './elevenlabs';
import type { ServerConfig } from './env';
import { cacheKey, type TtsCache } from './tts-cache';
import type { UsageTracker } from './usage';

export interface TtsRequest {
  text: string;
  lang: Lang;
  /** 1 is normal. */
  speed?: number;
  sessionId: string;
}

export interface TtsStream {
  sampleRate: number;
  model: string;
  cache: 'hit' | 'miss';
  /** Time from the request to the first audio byte. 0 for a cache hit. */
  ttfbMs: number;
  chunks: AsyncGenerator<Uint8Array>;
}

export class TtsError extends Error {
  constructor(
    public readonly code: 'no_voice' | 'bad_voice' | 'empty_text' | 'too_long' | 'tts_failed',
    message: string,
    public readonly status = 500,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
  }
}

export class TtsService {
  constructor(
    private readonly cfg: ServerConfig,
    private readonly port: ElevenLabsPort | null,
    private readonly cache: TtsCache,
    private readonly usage: UsageTracker,
    private readonly log: (line: string) => void = (l) => console.log(l),
  ) {}

  voiceFor(lang: Lang): string | undefined {
    return lang === 'th' ? this.cfg.voiceIdTh : this.cfg.voiceIdEn;
  }

  modelsFor(lang: Lang): string[] {
    return lang === 'th' ? this.cfg.ttsModelsTh : this.cfg.ttsModelsEn;
  }

  async open(req: TtsRequest, signal?: AbortSignal): Promise<TtsStream> {
    const text = req.text.trim();
    if (!text) throw new TtsError('empty_text', 'Nothing to say.', 400);
    if (text.length > this.cfg.ttsMaxChars) {
      throw new TtsError('too_long', `Text is ${text.length} characters. The limit is ${this.cfg.ttsMaxChars}.`, 400);
    }
    const voiceId = this.voiceFor(req.lang);
    if (!voiceId) {
      throw new TtsError('no_voice', `No voice set for ${req.lang}. Set VOICE_ID_${req.lang.toUpperCase()} in .env.`, 503);
    }
    const speed = req.speed ?? 1;
    const models = this.modelsFor(req.lang);
    const keyFor = (model: string) =>
      cacheKey({ voiceId, model, speed, outputFormat: this.cfg.ttsOutputFormat, text });

    // 1. Cache. Check every model we could have used, best model first.
    for (const model of models) {
      const hit = await this.cache.get(keyFor(model));
      if (hit) {
        this.usage.addTts(req.sessionId, text.length, true);
        return { sampleRate: hit.meta.sampleRate, model, cache: 'hit', ttfbMs: 0, chunks: hit.chunks() };
      }
    }

    // 2. ElevenLabs. Try models in order, moving on only if the model is rejected.
    if (!this.port) throw new TtsError('tts_failed', 'ElevenLabs is not configured (no API key).', 503);
    const started = performance.now();
    let lastError: unknown;
    for (const model of models) {
      try {
        const body = await this.port.streamSpeech(
          {
            voiceId,
            text,
            modelId: model,
            outputFormat: this.cfg.ttsOutputFormat,
            ...(req.lang === 'th' ? { languageCode: 'th' } : {}),
            speed,
          },
          signal,
        );
        const reader = body.getReader();
        const first = await reader.read(); // wait for the first audio, so we can time it
        const ttfbMs = Math.round(performance.now() - started);
        this.usage.addTts(req.sessionId, text.length, false);
        return {
          sampleRate: this.cfg.ttsSampleRate,
          model,
          cache: 'miss',
          ttfbMs,
          chunks: this.relayAndCache(reader, first, keyFor(model), { voiceId, model, speed, text }, signal),
        };
      } catch (err) {
        lastError = err;
        if (signal?.aborted) throw err;
        if (isBadVoice(err)) {
          // A typo in .env, not a model problem. Say so clearly instead of trying other models.
          throw new TtsError(
            'bad_voice',
            `ElevenLabs does not recognise the ${req.lang} voice ID. Check VOICE_ID_${req.lang.toUpperCase()} in .env (run: npm run check).`,
            502,
            err,
          );
        }
        if (!isModelRejection(err)) {
          const info = upstreamInfo(err);
          this.log(`[tts] failed with ${info.statusCode ?? 'no status'} ${info.apiStatus ?? ''}: ${info.message}`.slice(0, 300));
          break; // auth, quota, network: another model will not help
        }
        const info = upstreamInfo(err);
        this.log(`[tts] ${model} was rejected (${info.statusCode} ${info.apiStatus ?? ''}: ${info.message}). Trying the next model.`.slice(0, 300));
      }
    }
    throw new TtsError('tts_failed', 'Text-to-speech failed.', 502, lastError);
  }

  /** Pass chunks to the caller and collect them. Save to cache only if everything arrived. */
  private async *relayAndCache(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    first: ReadableStreamReadResult<Uint8Array>,
    key: string,
    parts: { voiceId: string; model: string; speed: number; text: string },
    signal?: AbortSignal,
  ): AsyncGenerator<Uint8Array> {
    const collected: Uint8Array[] = [];
    let result = first;
    let completed = false;
    try {
      while (!result.done) {
        if (signal?.aborted) return;
        collected.push(result.value);
        yield result.value;
        result = await reader.read();
      }
      completed = true;
    } finally {
      if (!completed) reader.cancel().catch(() => undefined);
    }
    if (completed && !signal?.aborted) {
      const audio = Buffer.concat(collected);
      await this.cache
        .put(
          key,
          {
            ...parts,
            outputFormat: this.cfg.ttsOutputFormat,
            sampleRate: this.cfg.ttsSampleRate,
            bytes: audio.byteLength,
            createdAt: new Date().toISOString(),
          },
          audio,
        )
        .catch((err) => this.log(`[tts] could not save cache file: ${(err as Error).message}`));
    }
  }
}
