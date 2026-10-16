// Barge-in: should Icarus stop talking because the user is talking over it?
//
// Background noise used to cut Icarus off: 120 ms of loudness was enough (a cough, a door, a laugh), and so was any
// partial transcript of two letters (Scribe guessing a word from noise, or hearing people nearby). Now Icarus stops
// only for real, sustained speech. ALL three must hold (the numbers are in config/defaults.ts, bargeIn):
//
//   (a) LOUD   the mic is clearly above the room's own level: above max(noise floor x levelRatio, minLevel).
//              The floor is learned all the time (client/noise-floor.ts), so a noisy room raises the bar by itself.
//   (b) LONG   and stays that way for sustainMs. Short dips (the pause in "wait, stop") are bridged, but most of the
//              stretch must be loud, so a door slam, a clap, a cough spike or typing is not enough.
//   (c) WORDS  and Scribe heard real words: minWords words, or one word of minLetters letters, or a stop word
//              ("stop", "wait", "หยุด", "เดี๋ยว"). Fillers ("uh", "mm", "okay") and sound tags ("(coughs)") are not
//              words, and Icarus's own voice coming back through the mic (echo, shared/transcript.ts) does not count.
//
// Scribe's words arrive about 1 to 2 seconds after the sound, so (c) usually comes after (a) and (b) are over. The
// words still count if they arrive within wordsWithinMs of the last loud frame, but NOT if they arrived before the
// loud stretch began: those belong to some other sound, like chatter in the background.
//
// Pure logic, no browser: the controller (icarus-voice.ts) feeds it mic frames and transcripts while Icarus talks.
// Tapping the mascot (stopSpeaking) and pressing push-to-talk never come through here. They always stop Icarus at once.

import { NOISE_FRAGMENTS } from '../config/voice-commands';
import { normalizeUtterance } from '../shared/commands';
import { isEchoOf, squash } from '../shared/transcript';
import { MIC_FRAME_MS } from './mic';

export interface BargeInConfig {
  levelRatio: number;
  minLevel: number;
  sustainMs: number;
  maxGapMs: number;
  minLoudShare: number;
  wordsWithinMs: number;
  minWords: number;
  minLetters: number;
  stopWords: { en: readonly string[]; th: readonly string[] };
  echoMinChars: number;
}

/** Why a transcript did not stop Icarus: Icarus's own voice, no real words, or no sustained loudness with the words. */
export type BargeInRejection = 'echo' | 'no_words' | 'background';

export type BargeInVerdict =
  | { interrupt: true; /** The first loud frame of the user's speech. */ startedAt: number }
  | { interrupt: false; reason: BargeInRejection };

interface LoudStretch {
  /** Time of the first loud frame. */
  startAt: number;
  /** Time of the latest loud frame. */
  lastLoudAt: number;
  /** Frames from the first loud one to the latest loud one, quiet ones in between included. */
  frames: number;
  loudFrames: number;
  /** Quiet frames since the latest loud one. */
  quietRun: number;
}

export class BargeInDetector {
  private saying = '';
  private stretch: LoudStretch | null = null;
  /** The latest stretch that met (a) and (b). Kept after it ends, so words that arrive late can still match it. */
  private sustained: { startAt: number; lastLoudAt: number } | null = null;
  /** When the latest transcript with real words arrived. */
  private wordsAt: number | null = null;

  constructor(private readonly cfg: BargeInConfig) {}

  /** Icarus starts saying `text`. Loudness and words heard before this no longer count. */
  begin(text: string): void {
    this.saying = text;
    this.reset();
  }

  /** Forget the loudness and words heard so far (Icarus was just interrupted). */
  reset(): void {
    this.stretch = null;
    this.sustained = null;
    this.wordsAt = null;
  }

  /** (a) The mic level (RMS) that counts as loud for this noise floor. */
  threshold(floor: number): number {
    return Math.max(floor * this.cfg.levelRatio, this.cfg.minLevel);
  }

  /**
   * One mic frame while Icarus is talking. Returns when the user began, if this frame completes the rule:
   * the words were already in, and now the loudness has lasted long enough.
   */
  frame(rms: number, nowMs: number, floor: number): { startedAt: number } | null {
    let s = this.stretch;
    if (!(rms > this.threshold(floor))) {
      // A pause longer than maxGapMs ends the stretch. (A stretch that already counted stays in `sustained`.)
      if (s && ++s.quietRun * MIC_FRAME_MS > this.cfg.maxGapMs) this.stretch = null;
      return null;
    }
    if (s) {
      s.frames += s.quietRun + 1;
      s.loudFrames += 1;
      s.quietRun = 0;
      s.lastLoudAt = nowMs;
    } else {
      s = this.stretch = { startAt: nowMs, lastLoudAt: nowMs, frames: 1, loudFrames: 1, quietRun: 0 };
    }
    // (b) Long enough, and mostly loud.
    if (s.frames * MIC_FRAME_MS < this.cfg.sustainMs || s.loudFrames / s.frames < this.cfg.minLoudShare) return null;
    this.sustained = { startAt: s.startAt, lastLoudAt: nowMs };
    return this.ready() ? { startedAt: s.startAt } : null;
  }

  /** A transcript (partial or final) arrived while Icarus is talking. Does it stop Icarus? */
  words(text: string, nowMs: number): BargeInVerdict {
    if (isEchoOf(text, this.saying, this.cfg.echoMinChars)) return { interrupt: false, reason: 'echo' };
    if (wordEvidence(text, this.cfg) === null) return { interrupt: false, reason: 'no_words' };
    this.wordsAt = nowMs;
    const s = this.sustained;
    return s && this.ready() ? { interrupt: true, startedAt: s.startAt } : { interrupt: false, reason: 'background' };
  }

  /** Real words that came with (or soon after) a sustained loud stretch. */
  private ready(): boolean {
    const s = this.sustained;
    const w = this.wordsAt;
    return s !== null && w !== null && w >= s.startAt && w - s.lastLoudAt <= this.cfg.wordsWithinMs;
  }
}

// ---------------------------------------------------------------------------
// (c) Is there a real word in this transcript?
// ---------------------------------------------------------------------------

export type WordEvidence = 'stop_word' | 'words' | 'long_word';

/** Fillers and noise words ("uh", "mm", "okay", "อืม", "ครับ") never count as words. */
const FILLERS = new Set([...NOISE_FRAGMENTS.en, ...NOISE_FRAGMENTS.th].map(squash));
/** Sound tags a recogniser may add, like "(coughs)", "[door slams]" or "*laughs*". */
const SOUND_TAGS = /\([^)]*\)|\[[^\]]*\]|\{[^}]*\}|\*[^*]*\*/g;
const THAI = /[฀-๿]/;

/**
 * Why this transcript counts as real words, or null if it does not: a stop word, at least minWords words, or one
 * word of at least minLetters letters. Thai has no spaces, so Thai is split into words with Intl.Segmenter.
 */
export function wordEvidence(text: string, cfg: Pick<BargeInConfig, 'minWords' | 'minLetters' | 'stopWords'>): WordEvidence | null {
  const clean = text.replace(SOUND_TAGS, ' ');
  const spaced = normalizeUtterance(clean);
  if (!spaced) return null;
  const compact = spaced.replace(/\s+/g, '');
  if (cfg.stopWords.en.some((w) => ` ${spaced} `.includes(` ${normalizeUtterance(w)} `))) return 'stop_word';
  if (cfg.stopWords.th.some((w) => compact.includes(normalizeUtterance(w).replace(/\s+/g, '')))) return 'stop_word';

  // Split on spaces and hyphens ("mm-hmm" is two fillers), then squash each word to its letters and digits.
  const words = clean
    .split(/[\s\-‐-―]+/u)
    .flatMap((token) => (THAI.test(token) ? thaiWords(token) : [token]))
    .map(squash)
    .filter((w) => w !== '' && !FILLERS.has(w));
  if (words.length >= cfg.minWords) return 'words';
  if (words.some((w) => [...w].length >= cfg.minLetters)) return 'long_word';
  return null;
}

let thaiSegmenter: Intl.Segmenter | null | undefined;

/** Thai words in a run of Thai text. Without Intl.Segmenter (very old browsers) the whole run counts as one word. */
function thaiWords(text: string): string[] {
  if (thaiSegmenter === undefined) {
    try {
      thaiSegmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
    } catch {
      thaiSegmenter = null;
    }
  }
  if (!thaiSegmenter) return [text];
  return [...thaiSegmenter.segment(text)].filter((s) => s.isWordLike).map((s) => s.segment);
}
