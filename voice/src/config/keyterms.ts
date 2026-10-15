// Words we want Scribe to listen for. Sent as `keyterms` when the mic session starts.
// Scribe Realtime limits (from the official SDK): max 50 terms, max 20 characters each.
// Keyterm prompting costs extra credits (ElevenLabs docs), so keep the list short.

export const KEYTERMS: string[] = [
  // App words
  'Icarus',
  'U-topia',
  'gold',
  'Bitcoin',
  'Ethereum',
  'USDT',
  'yield',
  'swap',
  'portfolio',
  'fee',
  'baht',
  // Confirm flow
  'confirm',
  'cancel',
  // THAI REVIEW: Thai app words. Keep each one at 20 characters or less.
  'ทอง',
  'บิตคอยน์',
  'อีเธอเรียม',
  'ค่าธรรมเนียม',
  'พอร์ต',
  'ผลตอบแทน',
  'ยืนยัน',
  'ยกเลิก',
];

export const MAX_KEYTERMS = 50;
export const MAX_KEYTERM_CHARS = 20;

/** Drop terms that Scribe would reject. Returns the usable list and what was dropped. */
export function sanitizeKeyterms(terms: string[]): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const raw of terms) {
    const term = raw.trim();
    if (!term || term.length > MAX_KEYTERM_CHARS || kept.length >= MAX_KEYTERMS) dropped.push(raw);
    else if (!kept.includes(term)) kept.push(term);
  }
  return { kept, dropped };
}
