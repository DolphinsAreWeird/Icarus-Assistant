// Tiny language helpers. Thai and English only.

import type { Lang } from './types';

const THAI_CHAR = /[฀-๿]/g;
const LATIN_CHAR = /[A-Za-z]/g;

/** True when the text has any Thai letters. */
export function hasThai(text: string): boolean {
  return /[฀-๿]/.test(text);
}

/**
 * Pick the language of a piece of text. We use this to choose the TTS voice,
 * so a Thai reply gets the Thai voice even if the UI is set to English.
 * Thai wins when at least 30% of the letters are Thai (numbers and names are often Latin).
 */
export function detectLang(text: string, fallback: Lang = 'en'): Lang {
  const thai = (text.match(THAI_CHAR) ?? []).length;
  const latin = (text.match(LATIN_CHAR) ?? []).length;
  const letters = thai + latin;
  if (letters === 0) return fallback;
  return thai / letters >= 0.3 ? 'th' : 'en';
}
