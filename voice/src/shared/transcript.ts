// Helpers for judging a transcript: how confident was Scribe, is it noise, is it Icarus hearing itself.

import { NOISE_FRAGMENTS } from '../config/voice-commands';
import { detectLang } from './lang';
import type { Lang } from './types';

export interface WordInfo {
  text?: string;
  type?: string;
  /** Scribe calls this a "confidence score". We treat values <= 0 as log probabilities. */
  logprob?: number;
}

/**
 * One 0 to 1 number for a whole transcript, from the per-word `logprob` values.
 * Only available when the session asks for timestamps.
 *
 * UNVERIFIED: the docs call logprob a "confidence score" but do not give its scale.
 * We assume log probabilities (zero or below). If every value is between 0 and 1 we
 * treat them as plain probabilities. The test page shows the raw result so you can tune the threshold.
 * Returns null when we cannot tell. Callers treat null as "not high".
 */
export function confidenceFromWords(words: WordInfo[] | null | undefined): number | null {
  const values = (words ?? [])
    .filter((w) => (w.type === undefined || w.type === 'word') && typeof w.logprob === 'number' && Number.isFinite(w.logprob))
    .map((w) => w.logprob as number);
  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.every((v) => v <= 0)) return Math.min(1, Math.exp(mean));
  if (values.every((v) => v >= 0 && v <= 1)) return mean;
  return null;
}

/**
 * Scale Scribe's raw score so that a clean utterance is about 1. `reference` is what clean speech
 * scores in that language (config/defaults.ts, confidenceReference). null stays null.
 */
export function normalizeConfidence(raw: number | null, reference: number): number | null {
  if (raw === null) return null;
  return Math.min(1, Math.max(0, raw / reference));
}

/** Letters and digits only, lowercase. Makes Thai and English text comparable. */
export function squash(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Is this partial transcript just Icarus's own voice coming back through the mic?
 * We compare it to what Icarus is saying right now. Short partials (like "stop") are never
 * treated as echo, so interrupting always works.
 */
export function isEchoOf(heard: string, currentlySaying: string, minChars: number): boolean {
  const h = squash(heard);
  const said = squash(currentlySaying);
  // Thai has no spaces, and Scribe's spelling of Icarus's own Thai voice drifts, so an exact match almost never
  // happens and Icarus cut itself off a second into every Thai line. For Thai we match loosely: if most letter
  // pairs in what was heard are in what Icarus is saying, it is echo. Short partials count too.
  if (THAI.test(h) && THAI.test(said) && h.length >= 2) return pairOverlap(h, said) >= 0.6;
  if (h.length < minChars) return false;
  return said.includes(h);
}

const THAI = /[฀-๿]/;

/** Share of the adjacent letter pairs in `a` that also appear somewhere in `b`. */
function pairOverlap(a: string, b: string): number {
  let hits = 0;
  for (let i = 0; i < a.length - 1; i++) if (b.includes(a.slice(i, i + 2))) hits++;
  return hits / (a.length - 1);
}

export interface FilterConfig {
  minConfidence: number;
  minCharsEn: number;
  minCharsTh: number;
}

export type RejectReason = 'empty' | 'too_short' | 'noise_word' | 'low_confidence';

/**
 * Should this final transcript start a turn? Rejects very short fragments, filler noises
 * and low-confidence results so background noise does not trigger the assistant.
 * `isCommand` skips the length rules, because "stop" is short on purpose.
 */
export function shouldAcceptFinal(
  input: { text: string; confidence: number | null },
  cfg: FilterConfig,
  isCommand: boolean,
): { accept: true } | { accept: false; reason: RejectReason } {
  const text = input.text.trim();
  if (!text) return { accept: false, reason: 'empty' };

  if (input.confidence !== null && input.confidence < cfg.minConfidence) {
    return { accept: false, reason: 'low_confidence' };
  }
  if (isCommand) return { accept: true };

  const lang: Lang = detectLang(text);
  const squashed = squash(text);
  const minChars = lang === 'th' ? cfg.minCharsTh : cfg.minCharsEn;
  if (squashed.length < minChars) return { accept: false, reason: 'too_short' };

  const noise = [...NOISE_FRAGMENTS.en, ...NOISE_FRAGMENTS.th].map(squash);
  if (noise.includes(squashed)) return { accept: false, reason: 'noise_word' };
  return { accept: true };
}
