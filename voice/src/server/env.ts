// Reads settings from environment variables (and from a .env file in the voice/ folder).
// The API key is only ever read here and by the ElevenLabs wrapper. It never goes to the browser.

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeKeyterms, KEYTERMS } from '../config/keyterms';

const here = path.dirname(fileURLToPath(import.meta.url));
export const VOICE_ROOT = path.resolve(here, '../..');

export interface ServerConfig {
  port: number;
  /** undefined when not set. Required for real ElevenLabs calls. */
  apiKey: string | undefined;
  /** Use fake ElevenLabs audio and tokens. For working on the UI with no key and no credits. */
  fakeElevenLabs: boolean;
  /** Optional REST base URL override, for example a regional endpoint. */
  restBaseUrl: string | undefined;
  /** Where the browser connects for speech-to-text. */
  sttWsBaseUrl: string;

  voiceIdEn: string | undefined;
  voiceIdTh: string | undefined;
  /** First is tried first. The rest are used only if ElevenLabs rejects the model. */
  ttsModelsEn: string[];
  ttsModelsTh: string[];
  /** Must be a pcm_* format. The browser plays raw 16-bit PCM. */
  ttsOutputFormat: string;
  ttsSampleRate: number;
  ttsMaxChars: number;

  stt: {
    commitStrategy: 'manual' | 'vad' | 'turn_prediction';
    vadSilenceSecs: number;
    vadThreshold: number;
    minSpeechMs: number;
    minSilenceMs: number;
    filterBackground: boolean;
    noVerbatim: boolean;
    keyterms: string[];
    droppedKeyterms: string[];
  };

  assistantMode: 'mock' | 'http';
  assistantUrl: string | undefined;
  assistantTimeoutMs: number;
  mockDelayMs: number;

  cacheDir: string;
  demoAudioDir: string;
  logDir: string;
  /** '*' or a list of allowed origins for CORS. */
  allowedOrigins: '*' | string[];
}

const num = (v: string | undefined, fallback: number) => {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (v: string | undefined, fallback: boolean) =>
  v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
const list = (v: string | undefined, fallback: string[]) =>
  v === undefined || v.trim() === '' ? fallback : v.split(',').map((s) => s.trim()).filter(Boolean);
const orUndefined = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const outputFormat = env.TTS_OUTPUT_FORMAT?.trim() || 'pcm_24000';
  const pcm = /^pcm_(\d+)$/.exec(outputFormat);
  if (!pcm) throw new Error(`TTS_OUTPUT_FORMAT must be a pcm format like pcm_24000, got "${outputFormat}"`);

  const strategy = (env.STT_COMMIT_STRATEGY?.trim() || 'vad') as ServerConfig['stt']['commitStrategy'];
  if (!['manual', 'vad', 'turn_prediction'].includes(strategy)) {
    throw new Error(`STT_COMMIT_STRATEGY must be manual, vad or turn_prediction, got "${strategy}"`);
  }
  const mode = (env.ASSISTANT_MODE?.trim() || 'mock') as ServerConfig['assistantMode'];
  if (!['mock', 'http'].includes(mode)) throw new Error(`ASSISTANT_MODE must be mock or http, got "${mode}"`);

  const { kept, dropped } = sanitizeKeyterms(KEYTERMS);
  const origins = env.ALLOWED_ORIGINS?.trim();
  const fake = bool(env.FAKE_ELEVENLABS, false);

  return {
    port: num(env.PORT, 8787),
    apiKey: orUndefined(env.ELEVENLABS_API_KEY),
    fakeElevenLabs: fake,
    restBaseUrl: orUndefined(env.ELEVENLABS_BASE_URL),
    sttWsBaseUrl: orUndefined(env.ELEVENLABS_WS_BASE_URL) ?? (fake ? `ws://localhost:${num(env.PORT, 8787)}` : 'wss://api.elevenlabs.io'),

    voiceIdEn: orUndefined(env.VOICE_ID_EN) ?? (fake ? 'fake-voice-en' : undefined),
    voiceIdTh: orUndefined(env.VOICE_ID_TH) ?? (fake ? 'fake-voice-th' : undefined),
    // Flash v2.5 is the fastest (about 75 ms) but does NOT support Thai (ElevenLabs models page).
    ttsModelsEn: list(env.TTS_MODEL_EN, ['eleven_flash_v2_5']),
    // v4 Turbo (about 100 ms) supports Thai. v4 and v3 are slower fallbacks that also support Thai.
    ttsModelsTh: list(env.TTS_MODEL_TH, ['eleven_v4_turbo', 'eleven_v4', 'eleven_v3']),
    ttsOutputFormat: outputFormat,
    ttsSampleRate: Number(pcm[1]),
    ttsMaxChars: num(env.TTS_MAX_CHARS, 1000),

    stt: {
      commitStrategy: strategy,
      // Silence before a turn ends. This is the biggest part of the "time to first audio".
      vadSilenceSecs: num(env.STT_VAD_SILENCE_SECS, 0.7),
      vadThreshold: num(env.STT_VAD_THRESHOLD, 0.4),
      minSpeechMs: num(env.STT_MIN_SPEECH_MS, 100),
      minSilenceMs: num(env.STT_MIN_SILENCE_MS, 100),
      filterBackground: bool(env.STT_FILTER_BACKGROUND, true),
      noVerbatim: bool(env.STT_NO_VERBATIM, true),
      keyterms: kept,
      droppedKeyterms: dropped,
    },

    assistantMode: mode,
    assistantUrl: orUndefined(env.ASSISTANT_URL),
    assistantTimeoutMs: num(env.ASSISTANT_TIMEOUT_MS, 15_000),
    mockDelayMs: num(env.MOCK_ASSISTANT_DELAY_MS, 120),

    cacheDir: path.resolve(VOICE_ROOT, env.AUDIO_CACHE_DIR?.trim() || '.audio-cache'),
    demoAudioDir: path.resolve(VOICE_ROOT, env.DEMO_AUDIO_DIR?.trim() || 'demo-audio'),
    logDir: path.resolve(VOICE_ROOT, env.LOG_DIR?.trim() || 'logs'),
    allowedOrigins: !origins || origins === '*' ? '*' : origins.split(',').map((s) => s.trim()),
  };
}

/** Replace the API key with [redacted] in anything we print. */
export function makeRedactor(apiKey: string | undefined): (text: string) => string {
  return (text: string) => (apiKey ? text.split(apiKey).join('[redacted]') : text);
}
