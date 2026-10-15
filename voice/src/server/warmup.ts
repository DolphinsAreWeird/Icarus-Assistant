// A voice from the ElevenLabs library is slow the FIRST time it speaks: 2 to 3 s to the first audio in our audition,
// then about 150 ms. So the server says one short word in each voice when it starts, and again every few minutes,
// so the first real reply (on stage) is not the slow one. It costs a few characters each time (TTS_WARMUP_MINUTES).
// It goes straight to ElevenLabs, not through the audio cache: a cached word would warm nothing.

import type { ElevenLabsPort } from './elevenlabs';
import { upstreamInfo } from './elevenlabs';
import type { ServerConfig } from './env';
import type { UsageTracker } from './usage';
import type { Lang } from '../shared/types';

const WORD: Record<Lang, string> = { en: 'Hi.', th: 'สวัสดี' };

/** Say one word in each configured voice. Never throws. Returns the time to first audio per language (null if it failed). */
export async function warmVoices(
  port: ElevenLabsPort,
  cfg: ServerConfig,
  usage: UsageTracker,
  log: (line: string) => void = (l) => console.log(l),
): Promise<Partial<Record<Lang, number | null>>> {
  const result: Partial<Record<Lang, number | null>> = {};
  for (const lang of ['en', 'th'] as const) {
    const voiceId = lang === 'en' ? cfg.voiceIdEn : cfg.voiceIdTh;
    const modelId = (lang === 'en' ? cfg.ttsModelsEn : cfg.ttsModelsTh)[0];
    if (!voiceId || !modelId) continue;
    const started = performance.now();
    try {
      const body = await port.streamSpeech({ voiceId, text: WORD[lang], modelId, outputFormat: cfg.ttsOutputFormat, ...(lang === 'th' ? { languageCode: 'th' } : {}) });
      const reader = body.getReader();
      let firstMs: number | null = null;
      for (;;) {
        const { done } = await reader.read();
        if (firstMs === null) firstMs = Math.round(performance.now() - started);
        if (done) break;
      }
      usage.addTts('warmup', WORD[lang].length, false);
      result[lang] = firstMs;
    } catch (err) {
      result[lang] = null;
      log(`  Voice warm-up (${lang}) failed: ${upstreamInfo(err).message}`);
    }
  }
  return result;
}

/** Warm now and then every `cfg.ttsWarmupMinutes`. Returns a function that stops it. */
export function startVoiceWarmup(port: ElevenLabsPort, cfg: ServerConfig, usage: UsageTracker, log: (line: string) => void = (l) => console.log(l)): () => void {
  if (cfg.ttsWarmupMinutes <= 0) return () => undefined;
  const run = () =>
    void warmVoices(port, cfg, usage, log).then((r) => {
      const parts = Object.entries(r).map(([lang, ms]) => `${lang.toUpperCase()} ${ms === null ? 'failed' : `${ms} ms`}`);
      if (parts.length) log(`  Voices warmed (first audio): ${parts.join(' | ')}`);
    });
  run();
  const timer = setInterval(run, cfg.ttsWarmupMinutes * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
