// Scribe v2 Realtime wire format. Checked against the ElevenLabs API reference and the
// official SDK source (wrapper/realtime). Used by the server (to build the URL) and the
// browser (to talk to the socket).

import type { WordInfo } from './transcript';

export interface SttUrlOptions {
  /** e.g. wss://api.elevenlabs.io */
  baseUrl: string;
  /** Single-use token from the server. Never the API key. */
  token: string;
  modelId?: string;
  languageCode?: string;
  commitStrategy: 'manual' | 'vad' | 'turn_prediction';
  vadSilenceSecs: number;
  vadThreshold: number;
  minSpeechMs: number;
  minSilenceMs: number;
  keyterms: string[];
  filterBackground: boolean;
  noVerbatim: boolean;
  /** Ask Scribe to detect the language (used when the user picked 'auto'). */
  detectLanguage: boolean;
}

export const STT_SAMPLE_RATE = 16000;

export function buildSttUrl(o: SttUrlOptions): string {
  const p = new URLSearchParams();
  p.set('model_id', o.modelId ?? 'scribe_v2_realtime');
  p.set('audio_format', 'pcm_16000');
  p.set('commit_strategy', o.commitStrategy);
  if (o.commitStrategy !== 'manual') {
    p.set('vad_silence_threshold_secs', String(o.vadSilenceSecs));
    p.set('vad_threshold', String(o.vadThreshold));
    p.set('min_speech_duration_ms', String(o.minSpeechMs));
    p.set('min_silence_duration_ms', String(o.minSilenceMs));
  }
  if (o.languageCode) p.set('language_code', o.languageCode);
  // Word timestamps carry the per-word confidence we need for the confirm flow.
  p.set('include_timestamps', 'true');
  if (o.detectLanguage) p.set('include_language_detection', 'true');
  for (const term of o.keyterms) p.append('keyterms', term);
  p.set('filter_background_audio', String(o.filterBackground));
  p.set('no_verbatim', String(o.noVerbatim));
  p.set('token', o.token);
  return `${o.baseUrl.replace(/\/$/, '')}/v1/speech-to-text/realtime?${p.toString()}`;
}

/** Remove the token before showing a URL in logs. */
export function redactUrl(url: string): string {
  return url.replace(/([?&]token=)[^&]+/, '$1[redacted]');
}

export type SttMessage =
  | { kind: 'session_started'; sessionId: string }
  | { kind: 'partial'; text: string }
  | { kind: 'committed'; text: string }
  | { kind: 'committed_with_timestamps'; text: string; languageCode: string | null; words: WordInfo[] }
  | { kind: 'warning'; message: string }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'other'; messageType: string };

/** Parse one JSON text frame from Scribe. Returns null if it is not valid JSON. */
export function parseSttMessage(raw: string): SttMessage | null {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const type = typeof data.message_type === 'string' ? data.message_type : '';
  const text = typeof data.text === 'string' ? data.text : '';
  switch (type) {
    case 'session_started':
      return { kind: 'session_started', sessionId: String(data.session_id ?? '') };
    case 'partial_transcript':
      return { kind: 'partial', text };
    case 'committed_transcript':
      return { kind: 'committed', text };
    case 'committed_transcript_with_timestamps':
      return {
        kind: 'committed_with_timestamps',
        text,
        languageCode: typeof data.language_code === 'string' ? data.language_code : null,
        words: Array.isArray(data.words) ? (data.words as WordInfo[]) : [],
      };
    case 'warning':
      return { kind: 'warning', message: String(data.warning ?? '') };
    default:
      // auth_error, quota_exceeded, rate_limited, input_error ... all carry an `error` string.
      if (typeof data.error === 'string') return { kind: 'error', code: type || 'error', message: data.error };
      return { kind: 'other', messageType: type };
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/** One JSON frame carrying audio (16-bit PCM, little endian). `commit` ends the segment (manual mode). */
export function audioFrame(pcm: Uint8Array, commit = false, sampleRate = STT_SAMPLE_RATE): string {
  return JSON.stringify({
    message_type: 'input_audio_chunk',
    audio_base_64: toBase64(pcm),
    commit,
    sample_rate: sampleRate,
  });
}

/** A commit with no audio. This is what the official SDK sends for `connection.commit()`. */
export function commitFrame(sampleRate = STT_SAMPLE_RATE): string {
  return JSON.stringify({
    message_type: 'input_audio_chunk',
    audio_base_64: '',
    commit: true,
    sample_rate: sampleRate,
  });
}
