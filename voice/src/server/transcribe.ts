// Plays recorded speech into the live Scribe and returns what it heard. Used to CHECK a voice:
// if Scribe understands what a text-to-speech voice says, people probably will too.
// Not used in the running app.

import type { ElevenLabsPort } from './elevenlabs';
import type { ServerConfig } from './env';
import { buildSttUrl, parseSttMessage, STT_SAMPLE_RATE } from '../shared/stt-protocol';
import type { Lang } from '../shared/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * @param pcm 16 kHz mono 16-bit speech. It is streamed in real time, like a microphone would.
 * @returns everything Scribe committed, joined with spaces. Empty string if it heard nothing.
 */
export async function transcribePcm16k(
  port: ElevenLabsPort,
  cfg: ServerConfig,
  pcm: Uint8Array,
  lang: Lang,
  opts: { baseUrl?: string; leadSilenceSec?: number; tailSilenceSec?: number; settleSec?: number } = {},
): Promise<string> {
  const token = await port.createRealtimeToken();
  const url = buildSttUrl({
    baseUrl: opts.baseUrl ?? cfg.sttWsBaseUrl,
    token,
    languageCode: lang,
    commitStrategy: 'vad',
    vadSilenceSecs: 0.5,
    vadThreshold: 0.4,
    minSpeechMs: 100,
    minSilenceMs: 100,
    keyterms: [],
    noVerbatim: false,
    detectLanguage: false,
  });
  const ws = new WebSocket(url);
  const finals: string[] = [];
  let lastFinalAt = 0;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Scribe did not start in time')), 10_000);
    ws.onmessage = (e) => {
      const m = parseSttMessage(String(e.data));
      if (!m) return;
      if (m.kind === 'session_started') {
        clearTimeout(timer);
        resolve();
      } else if (m.kind === 'error') {
        clearTimeout(timer);
        reject(new Error(`${m.code}: ${m.message}`));
      } else if (m.kind === 'committed' && m.text.trim()) {
        finals.push(m.text.trim());
        lastFinalAt = performance.now();
      }
    };
    ws.onerror = () => reject(new Error('Scribe socket error'));
  });

  // Scribe starts transcribing after about 2 s of audio, so lead with a little silence.
  const chunk = (STT_SAMPLE_RATE / 10) * 2; // 100 ms
  const frame = (bytes: Uint8Array) =>
    JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: Buffer.from(bytes).toString('base64'), commit: false, sample_rate: STT_SAMPLE_RATE });
  const start = performance.now();
  let slots = 0;
  const nextSlot = async () => {
    slots += 1;
    const wait = start + slots * 100 - performance.now();
    if (wait > 0) await sleep(wait);
  };
  const silence = new Uint8Array(chunk);
  for (let i = 0; i < Math.round((opts.leadSilenceSec ?? 2.2) * 10); i++) {
    await nextSlot();
    ws.send(frame(silence));
  }
  for (let offset = 0; offset < pcm.length; offset += chunk) {
    const part = pcm.subarray(offset, offset + chunk);
    await nextSlot();
    ws.send(frame(part.length === chunk ? part : Uint8Array.from([...part, ...new Uint8Array(chunk - part.length)])));
  }
  // Keep the quiet coming. Scribe commits the LAST sentence only after it has heard silence, and it answers about
  // a second later. Stop once nothing new has arrived for `settleSec` (counted from the end of the audio at the earliest).
  const audioEndedAt = performance.now();
  const settleMs = (opts.settleSec ?? 1.8) * 1000;
  for (let i = 0; i < Math.round((opts.tailSilenceSec ?? 6) * 10); i++) {
    if (performance.now() - Math.max(lastFinalAt, audioEndedAt) > settleMs) break;
    await nextSlot();
    ws.send(frame(silence));
  }
  ws.close();
  return finals.join(' ');
}

/**
 * Change the sample rate of 16-bit mono PCM. Linear interpolation, with a simple averaging filter first when going
 * down, which is plenty for speech recognition and pitch checks. (Text-to-speech gives 24 kHz, Scribe wants 16 kHz.)
 */
export function resamplePcm16(pcm: Uint8Array, fromRate: number, toRate: number): Uint8Array {
  const input = new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + (pcm.byteLength & ~1)));
  if (fromRate === toRate) return new Uint8Array(input.buffer);
  let source: Float32Array = Float32Array.from(input);
  const width = Math.round(fromRate / toRate);
  if (width > 1) {
    const smoothed = new Float32Array(source.length);
    for (let i = 0; i < source.length; i++) {
      let sum = 0;
      let n = 0;
      for (let k = -Math.floor(width / 2); k <= Math.floor(width / 2); k++) {
        const v = source[i + k];
        if (v !== undefined) {
          sum += v;
          n += 1;
        }
      }
      smoothed[i] = sum / n;
    }
    source = smoothed;
  }
  const outLength = Math.floor((source.length * toRate) / fromRate);
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const at = (i * fromRate) / toRate;
    const left = Math.floor(at);
    const a = source[left] ?? 0;
    const b = source[left + 1] ?? a;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(a + (b - a) * (at - left))));
  }
  return new Uint8Array(out.buffer);
}

export interface SpokenCheck {
  /** What Scribe wrote down. */
  heard: string;
  /** 1 = the words match exactly (numbers left out of this score). */
  match: number;
  /** Were the numbers right? undefined when the line has no numbers. */
  numbersRight?: boolean;
}

/** Play a clip into the live Scribe and compare what it heard with what the line was meant to say. */
export async function checkSpoken(
  port: ElevenLabsPort,
  cfg: ServerConfig,
  pcm16k: Uint8Array,
  lang: Lang,
  expected: string,
  opts?: Parameters<typeof transcribePcm16k>[4],
): Promise<SpokenCheck> {
  const heard = await transcribePcm16k(port, cfg, pcm16k, lang, opts);
  const wanted = spokenNumbers(expected);
  return {
    heard,
    match: similarity(expected, heard),
    ...(wanted.length > 0 ? { numbersRight: JSON.stringify(wanted) === JSON.stringify(spokenNumbers(heard)) } : {}),
  };
}

// ---- Comparing what was said with what was heard ----

const THAI_DIGITS: Record<string, number> = { ศูนย์: 0, หนึ่ง: 1, สอง: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6, เจ็ด: 7, แปด: 8, เก้า: 9 };
const THAI_UNITS: Record<string, number> = { สิบ: 10, ร้อย: 100, พัน: 1000, หมื่น: 10_000, แสน: 100_000 };
const THAI_NUMBER_RUN = /(?:ศูนย์|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|ยี่|เอ็ด|ร้อย|พัน|หมื่น|แสน|ล้าน)+/g;
const THAI_NUMBER_WORDS_ALT = 'ศูนย์|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|ยี่|เอ็ด|ร้อย|พัน|หมื่น|แสน|ล้าน|จุด|เปอร์เซ็นต์';

const NUMBER_WORDS = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|point|percent)\b/gi;

const THAI_NUMBER_WORDS = new RegExp(THAI_NUMBER_WORDS_ALT, 'g');

/**
 * Letters only, lower case, numbers removed (digits, English number words, Thai number words). A speech engine says
 * "two point three percent" and Scribe writes "2.3%", so numbers are left out of the comparison on both sides.
 * Whether the NUMBERS were right is checked separately, with spokenNumbers().
 */
export function comparable(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(NUMBER_WORDS, ' ')
    .replace(THAI_NUMBER_WORDS, ' ')
    .replace(/[\d.,%฿$]+/g, ' ')
    .replace(/[^\p{L}\p{M}]+/gu, '');
}

const EN_UNITS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const EN_TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const EN_RUN = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|point)(?:[\s-]+(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|point))*\b/gi;

function englishWordsToNumber(run: string): number {
  let total = 0;
  let current = 0;
  let decimals = '';
  let afterPoint = false;
  for (const word of run.toLowerCase().split(/[\s-]+/)) {
    if (word === 'point') afterPoint = true;
    else if (afterPoint) decimals += String(EN_UNITS[word] ?? 0);
    else if (word in EN_UNITS) current += EN_UNITS[word] as number;
    else if (word in EN_TENS) current += EN_TENS[word] as number;
    else if (word === 'hundred') current = (current || 1) * 100;
    else if (word === 'thousand' || word === 'million') {
      total += (current || 1) * (word === 'thousand' ? 1000 : 1_000_000);
      current = 0;
    }
  }
  return Number(`${total + current}${decimals ? `.${decimals}` : ''}`);
}

function thaiWordsToNumber(run: string): number {
  let total = 0;
  let pending: number | null = null;
  const tokens = run.match(/ศูนย์|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|ยี่|เอ็ด|ร้อย|พัน|หมื่น|แสน|ล้าน/g) ?? [];
  for (const t of tokens) {
    if (t in THAI_DIGITS) pending = THAI_DIGITS[t] as number;
    else if (t === 'ยี่') pending = 2;
    else if (t === 'เอ็ด') pending = 1;
    else if (t === 'ล้าน') {
      total = (total + (pending ?? 0) || 1) * 1_000_000;
      pending = null;
    } else {
      total += (pending ?? 1) * (THAI_UNITS[t] as number);
      pending = null;
    }
  }
  return total + (pending ?? 0);
}

/**
 * Every number in a line, in order, whether it is written in digits ("1,015", "2.3") or spoken as words
 * ("one thousand fifteen", "หนึ่งพันสิบห้า"). Used to check that a voice said the RIGHT amount, because Scribe
 * writes numbers either way. Built for our own short lines, not for general text.
 */
export function spokenNumbers(text: string): number[] {
  const found: { at: number; value: number }[] = [];
  const t = text.normalize('NFKC');
  for (const m of t.matchAll(/\d[\d,]*(?:\.\d+)?/g)) found.push({ at: m.index ?? 0, value: Number(m[0].replace(/,/g, '')) });
  for (const m of t.matchAll(EN_RUN)) found.push({ at: m.index ?? 0, value: englishWordsToNumber(m[0]) });
  for (const m of t.matchAll(THAI_NUMBER_RUN)) found.push({ at: m.index ?? 0, value: thaiWordsToNumber(m[0]) });
  return found.sort((a, b) => a.at - b.at).map((f) => f.value);
}

/** 1 means identical, 0 means nothing in common. Edit distance on the letters. */
export function similarity(expected: string, heard: string): number {
  const a = comparable(expected);
  const b = comparable(heard);
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_v, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const saved = prev[j] as number;
      prev[j] = Math.min((prev[j] as number) + 1, (prev[j - 1] as number) + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = saved;
    }
  }
  return 1 - (prev[b.length] as number) / Math.max(a.length, b.length);
}
