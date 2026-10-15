// Turns assistant text into text that sounds right when read aloud.
//
//   "**Gold** is down -2.3% (฿1,015)"  ->  "Gold is down 2.3 percent (about 1,000 baht)"
//
// What it does, in order:
//   1. strips markdown, links and emoji
//   2. says dates and times the way people do
//   3. says percents and money in words, and rounds them ("about 1,000 baht")
//   4. cuts long replies down to a short spoken version
//
// Money read-backs do NOT go through the rounding. They are built from the structured
// preview in readback.ts and use exact numbers.

import { STRINGS, fill } from '../config/strings';
import type { Lang } from './types';

export interface SpeechOptions {
  lang: Lang;
  /** Keep every digit exactly. No rounding, no "about". */
  exact?: boolean;
  /** For tests: "today". Used to drop the current year from dates. */
  now?: Date;
  /** Longest reply we speak in full. Default 3 sentences. */
  maxSentences?: number;
  /** Longest reply we speak in full, in characters. */
  maxChars?: number;
  /** Set false to skip the short-version step. */
  shorten?: boolean;
}

const DEFAULT_MAX_SENTENCES = 3;
const DEFAULT_MAX_CHARS: Record<Lang, number> = { en: 320, th: 200 };

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function toSpeakable(text: string, opts: SpeechOptions): string {
  let out = stripMarkdown(text);
  out = speakDates(out, opts); // before symbols, so 2026-10-15 is not read as a range
  out = speakSymbols(out, opts);
  out = speakNumbers(out, opts);
  out = cleanSpaces(out);
  out = applyPronunciations(out, opts.lang);
  if (opts.shorten !== false) {
    out = shortenForSpeech(out, opts);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Step 1: markdown, links, emoji
// ---------------------------------------------------------------------------

export function stripMarkdown(text: string): string {
  let out = text.replace(/\r\n/g, '\n');
  out = out.replace(/```[\s\S]*?```/g, ' '); // code blocks are not read aloud
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1'); // images -> alt text
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // links -> link text
  out = out.replace(/https?:\/\/\S+/g, ' '); // bare URLs
  out = out.replace(/`([^`]*)`/g, '$1'); // inline code

  // Line by line: headings, bullets, numbering. Make each line its own sentence.
  const lines = out
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*#{1,6}\s*/, '')
        .replace(/^\s*>\s?/, '')
        .replace(/^\s*[-*•]\s+/, '')
        .replace(/^\s*\d+[.)]\s+/, '')
        .replace(/\|/g, ', ')
        .trim(),
    )
    .filter((line) => line.length > 0)
    .map((line) => (/[.!?:;,。]['")\]]*$/.test(line) ? line : `${line}.`));
  out = lines.join(' ');

  out = out.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1'); // bold and italics
  out = out.replace(/(?<![\w])_{1,2}([^_]+)_{1,2}(?![\w])/g, '$1');
  out = out.replace(/~~([^~]+)~~/g, '$1');
  out = out.replace(/[\p{Extended_Pictographic}️‍]/gu, ''); // emoji
  return out;
}

// ---------------------------------------------------------------------------
// Step 2: symbols
// ---------------------------------------------------------------------------

function speakSymbols(text: string, opts: SpeechOptions): string {
  const w = STRINGS[opts.lang].words;
  let out = text;
  out = out.replace(/≈|~(?=\s?\d)/g, ` ${w.about} `);
  out = out.replace(/→|->/g, ` ${w.to} `);
  out = out.replace(/\s&\s/g, ` ${w.and} `);
  // A range between numbers: 5-10 with a hyphen, an en dash or an em dash.
  out = out.replace(/(\d)\s?[\u2013\u2014]\s?(\d)/g, `$1 ${w.rangeTo} $2`);
  out = out.replace(/(\d)-(\d)/g, (_m, a: string, b: string) => {
    return `${a} ${w.rangeTo} ${b}`;
  });
  // Em and en dashes between words are a pause.
  out = out.replace(/\s?[\u2013\u2014]\s?/g, ', ');
  return out;
}

// ---------------------------------------------------------------------------
// Step 3: dates, times, percent, money
// ---------------------------------------------------------------------------

const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Times, percents, money and short units. Dates are handled earlier by speakDates. */
export function speakNumbers(text: string, opts: SpeechOptions): string {
  let out = text;
  if (opts.lang === 'en') out = speakTimes(out);
  out = speakPercents(out, opts);
  out = speakMoney(out, opts);
  out = speakUnits(out, opts.lang);
  return out;
}

function formatDate(day: number, month: number, year: number, opts: SpeechOptions): string {
  const s = STRINGS[opts.lang];
  const now = opts.now ?? new Date();
  const sameYear = year === now.getFullYear();
  const shownYear = s.buddhistEra ? year + 543 : year;
  const monthName = s.months[month - 1] ?? '';
  return fill(sameYear ? s.dateNoYear : s.dateWithYear, { day, month: monthName, year: shownYear });
}

function validDate(day: number, month: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

export function speakDates(text: string, opts: SpeechOptions): string {
  let out = text;
  // 2026-10-15 and 2026-10-15T14:30:00Z
  out = out.replace(/\b(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?\b/g, (m, y: string, mo: string, d: string) =>
    validDate(Number(d), Number(mo)) ? formatDate(Number(d), Number(mo), Number(y), opts) : m,
  );
  const monthPattern = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?';
  // 15 Oct 2026, 15th October 2026
  out = out.replace(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${monthPattern},?\\s+(\\d{4})\\b`, 'gi'),
    (m, d: string, mon: string, y: string) => {
      const month = MONTH_ABBR.indexOf(mon.slice(0, 3).toLowerCase()) + 1;
      return validDate(Number(d), month) ? formatDate(Number(d), month, Number(y), opts) : m;
    },
  );
  // Oct 15, 2026
  out = out.replace(
    new RegExp(`\\b${monthPattern}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'),
    (m, mon: string, d: string, y: string) => {
      const month = MONTH_ABBR.indexOf(mon.slice(0, 3).toLowerCase()) + 1;
      return validDate(Number(d), month) ? formatDate(Number(d), month, Number(y), opts) : m;
    },
  );
  return out;
}

/** 14:30 -> 2:30 PM. English only. */
function speakTimes(text: string): string {
  return text.replace(/(?<![\w.:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/g, (_m, h: string, min: string) => {
    const hour = Number(h);
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    return min === '00' ? `${hour12} ${suffix}` : `${hour12}:${min} ${suffix}`;
  });
}

// ----- percent -----

const DOWN_WORDS = /(down|fell|fall|falls|dropped|drops|drop|lost|loses|declined|dipped|slipped|ลดลง|ร่วง|ตก)\s*$/i;
const UP_WORDS = /(up|rose|rises|gained|gains|jumped|climbed|surged|เพิ่มขึ้น|ขึ้น|พุ่ง)\s*$/i;
const ABOUT_WORDS = /(about|around|roughly|approximately|ประมาณ)\s*$/i;

function speakPercents(text: string, opts: SpeechOptions): string {
  const w = STRINGS[opts.lang].words;
  const pct = w.percent;
  // Ranges first: 5-10% was already turned into "5 to 10%" by speakSymbols.
  return text.replace(
    // A space is only allowed between the sign and the number ("- 2.3%"), never before the match.
    /(?<![\w.])(?:([+\-−])\s?)?(\d+(?:\.\d+)?)\s?%/g,
    (_m, sign: string | undefined, num: string, offset: number) => {
      const before = text.slice(0, offset);
      const value = Number(num);
      const { text: spoken, rounded } = opts.exact ? { text: num, rounded: false } : roundPercent(value);
      const about = rounded && !ABOUT_WORDS.test(before) ? `${w.about} ` : '';
      const body = `${about}${spoken} ${pct}`;
      if (sign === '-' || sign === '−') {
        return DOWN_WORDS.test(before) ? body : `${w.down} ${body}`;
      }
      if (sign === '+') {
        return UP_WORDS.test(before) ? body : `${w.up} ${body}`;
      }
      return body;
    },
  );
}

/** Under 10 percent keep one decimal. From 10 up, whole numbers with "about". */
function roundPercent(value: number): { text: string; rounded: boolean } {
  if (value < 10) {
    const one = Number(value.toFixed(1));
    return { text: String(one), rounded: false };
  }
  const whole = Math.round(value);
  return { text: String(whole), rounded: whole !== value };
}

// ----- money -----

const CURRENCY_SYMBOL: Record<string, string> = { '฿': 'THB', $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };
const CODES = 'THB|USD|EUR|GBP|JPY|USDT|USDC|BTC|ETH';
const MULT = '(?:k|m|bn|b|million|billion)';
const MULT_VALUE: Record<string, number> = { k: 1e3, m: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

function speakMoney(text: string, opts: SpeechOptions): string {
  const s = STRINGS[opts.lang];
  let out = text;

  // Symbol before the number: ฿1,015 and $1.2M. Rewrite to "1,015 THB" so one rule handles all.
  out = out.replace(
    new RegExp(`([฿$€£¥])\\s?(\\d[\\d,]*(?:\\.\\d+)?)(\\s?${MULT}\\b)?`, 'gi'),
    (_m, sym: string, num: string, mult: string | undefined) =>
      `${num}${mult ?? ''} ${CURRENCY_SYMBOL[sym] ?? ''}`,
  );
  // Code before the number: THB 1,015.
  out = out.replace(
    new RegExp(`\\b(${CODES})\\s(\\d[\\d,]*(?:\\.\\d+)?)(\\s?${MULT}\\b)?`, 'g'),
    (_m, code: string, num: string, mult: string | undefined) => `${num}${mult ?? ''} ${code}`,
  );

  // Number then currency code or word. Say it, round it.
  const amount = '(\\d[\\d,]*(?:\\.\\d+)?)';
  const currency = `(${CODES}|baht|dollars?|euros?|บาท)(?![A-Za-z])`;
  out = out.replace(
    new RegExp(`(?<![\\w.,])${amount}(?:\\s?(${MULT})\\b)?\\s?${currency}`, 'gi'),
    (_m, num: string, mult: string | undefined, cur: string, offset: number) => {
      const before = out.slice(0, offset);
      const value = Number(num.replace(/,/g, '')) * (mult ? (MULT_VALUE[mult.toLowerCase()] ?? 1) : 1);
      const word = s.currencyWords[cur.toUpperCase()] ?? cur;
      const { text: spoken, rounded } = speakAmount(value, opts);
      const about = rounded && !ABOUT_WORDS.test(before) ? `${s.words.about} ` : '';
      return `${about}${spoken} ${word}`;
    },
  );
  return out;
}

/** Say an amount. Rounds to 2 significant digits for speech unless exact. */
function speakAmount(value: number, opts: SpeechOptions): { text: string; rounded: boolean } {
  const w = STRINGS[opts.lang].words;
  if (opts.exact) return { text: formatExactNumber(value), rounded: false };

  const abs = Math.abs(value);
  let rounded: number;
  if (abs < 1) rounded = Number(value.toPrecision(2));
  else if (abs < 100) rounded = Math.round(value);
  else rounded = roundSignificant(value, 2);

  const changed = rounded !== value;
  if (Math.abs(rounded) >= 1e9) return { text: `${trim(rounded / 1e9)} ${w.billion}`, rounded: changed };
  if (Math.abs(rounded) >= 1e6) return { text: `${trim(rounded / 1e6)} ${w.million}`, rounded: changed };
  return { text: formatPlain(rounded), rounded: changed };
}

function roundSignificant(value: number, digits: number): number {
  if (value === 0) return 0;
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const factor = Math.pow(10, magnitude - digits + 1);
  return Math.round(value / factor) * factor;
}

function trim(n: number): string {
  return String(Number(n.toFixed(2)));
}

function formatPlain(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * The exact way we say a number in a money read-back.
 * Whole numbers get commas. Anything with decimals shows at least two decimals,
 * so 1015.5 is spoken as "1,015.50" and never confused with 1,015.
 */
export function formatExactNumber(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString('en-US');
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}

// ----- short units: 24h, 7d -----

function speakUnits(text: string, lang: Lang): string {
  const units = STRINGS[lang].units;
  return text.replace(
    /(?<![\w.])(\d+)\s?([hdwy])(?![A-Za-z0-9])/g,
    (_m, n: string, u: string, offset: number, whole: string) => {
      const unit = units[u as 'h' | 'd' | 'w' | 'y'];
      // "the 24h change" reads better as "24 hour change". "in 24h." stays plural.
      const nounFollows = /^\s+[A-Za-z]/.test(whole.slice(offset + _m.length));
      const singular = Number(n) === 1 || nounFollows;
      return `${n} ${singular ? unit.one : unit.many}`;
    },
  );
}

// ---------------------------------------------------------------------------
// Cleanup and pronunciation
// ---------------------------------------------------------------------------

function cleanSpaces(text: string): string {
  return text
    .replace(/[*_#`>|\\^{}<]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/([,.;:!?])\1+/g, '$1')
    .replace(/,\s*([.!?])/g, '$1')
    .replace(/^[\s,.;:]+/, '')
    .trim();
}

function applyPronunciations(text: string, lang: Lang): string {
  let out = text;
  for (const [from, to] of Object.entries(STRINGS[lang].pronunciations)) {
    out = out.split(from).join(to);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Step 4: short version of long replies
// ---------------------------------------------------------------------------

/**
 * Split into sentences at full stops, question marks and line breaks.
 * Decimals like 2.3 are safe because there is no space after the dot.
 * Thai uses spaces inside a sentence ("2.3 เปอร์เซ็นต์"), so we never split Thai at spaces.
 * A long Thai reply with no punctuation is caught by the character limit instead.
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * More than about 3 sentences: speak the first two and point to the screen.
 * The full text always stays on screen. Only the voice gets the short version.
 */
export function shortenForSpeech(text: string, opts: SpeechOptions): string {
  const maxSentences = opts.maxSentences ?? DEFAULT_MAX_SENTENCES;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS[opts.lang];
  const sentences = splitSentences(text);
  if (sentences.length <= maxSentences && text.length <= maxChars) return text;

  const kept: string[] = [];
  let length = 0;
  for (const sentence of sentences) {
    if (kept.length >= 2) break;
    if (kept.length > 0 && length + sentence.length > maxChars) break;
    kept.push(sentence);
    length += sentence.length + 1;
  }
  let short = kept.join(' ');
  if (short.length > maxChars) short = cutAtWord(short, maxChars);
  const pointer = STRINGS[opts.lang].lines.longReplyPointer;
  return `${short} ${pointer}`.trim();
}

function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[,;:\s]+$/, '') + '.';
}
