// ALL words Icarus says that are not written by the assistant live in this file.
// This is the file for the Thai-speaking teammate: search for "THAI REVIEW" and edit.
//
// Style: short, calm, plain words. No em dashes. {curly} parts are filled in by code.
// The Thai strings below are a first draft and have NOT been checked by a Thai speaker.
// Gender particles (ครับ / ค่ะ) are left out on purpose. Add them to match the chosen voice.

import type { Lang } from '../shared/types';

export interface Strings {
  /** Currency code to spoken word. Used for "THB 1,015" and "฿1,015". */
  currencyWords: Record<string, string>;
  /** Asset id to spoken name. Used in read-backs when the preview has no spoken name. */
  assetNames: Record<string, string>;
  words: {
    percent: string;
    down: string;
    up: string;
    about: string;
    and: string;
    to: string;
    /** Between two numbers: "5 to 10". */
    rangeTo: string;
    million: string;
    billion: string;
  };
  /** Short units: "24h" becomes "24 hours". */
  units: Record<'h' | 'd' | 'w' | 'y', { one: string; many: string }>;
  months: string[];
  /** Date templates. {day} {month} {year}. */
  dateWithYear: string;
  dateNoYear: string;
  /** Thai years are Buddhist Era (add 543). */
  buddhistEra: boolean;
  /** Money read-back pieces. Exact numbers only. */
  readback: {
    buy: string;
    sell: string;
    deposit: string;
    fee: string;
    total: string;
    prompt: string;
  };
  /** Fixed lines. These are cached, so they cost credits only once. */
  lines: {
    didntCatch: string;
    cancelled: string;
    goingBack: string;
    louder: string;
    slower: string;
    nothingToRepeat: string;
    longReplyPointer: string;
    previewUnreadable: string;
  };
  /** Words the speech engine may get wrong. Left side is replaced by the right side. */
  pronunciations: Record<string, string>;
}

export const STRINGS: Record<Lang, Strings> = {
  en: {
    currencyWords: {
      THB: 'baht',
      USD: 'dollars',
      EUR: 'euros',
      GBP: 'pounds',
      JPY: 'yen',
      BTC: 'Bitcoin',
      ETH: 'Ethereum',
      USDT: 'USDT',
      USDC: 'USDC',
    },
    assetNames: {
      gold: 'gold',
      bitcoin: 'Bitcoin',
      btc: 'Bitcoin',
      ethereum: 'Ethereum',
      eth: 'Ethereum',
      usdt: 'USDT',
    },
    words: {
      percent: 'percent',
      down: 'down',
      up: 'up',
      about: 'about',
      and: 'and',
      to: 'to',
      rangeTo: 'to',
      million: 'million',
      billion: 'billion',
    },
    units: {
      h: { one: 'hour', many: 'hours' },
      d: { one: 'day', many: 'days' },
      w: { one: 'week', many: 'weeks' },
      y: { one: 'year', many: 'years' },
    },
    months: [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ],
    dateWithYear: '{month} {day}, {year}',
    dateNoYear: '{month} {day}',
    buddhistEra: false,
    readback: {
      buy: '{amount} {currency} into {asset}.',
      sell: 'Selling {amount} {currency} of {asset}.',
      deposit: 'Deposit {amount} {currency}.',
      fee: 'Fee {fee} {currency}.',
      total: 'Total {total} {currency}.',
      prompt: 'Say confirm or cancel.',
    },
    lines: {
      didntCatch: "Sorry, I didn't catch that. Say confirm or cancel.",
      cancelled: 'Okay, cancelled.',
      goingBack: 'Going back.',
      louder: 'Okay. Is this better?',
      slower: "Sure, I'll slow down.",
      nothingToRepeat: "I haven't said anything yet.",
      longReplyPointer: 'The rest is on your screen.',
      previewUnreadable: "I can't read that out loud. Please check the card on your screen.",
    },
    pronunciations: {
      'U-topia': 'You topia',
    },
  },

  // THAI REVIEW: every string below needs a Thai speaker to check wording and tone.
  th: {
    currencyWords: {
      THB: 'บาท',
      USD: 'ดอลลาร์',
      EUR: 'ยูโร',
      GBP: 'ปอนด์',
      JPY: 'เยน',
      BTC: 'บิตคอยน์',
      ETH: 'อีเธอเรียม',
      USDT: 'USDT',
      USDC: 'USDC',
    },
    assetNames: {
      gold: 'ทอง',
      bitcoin: 'บิตคอยน์',
      btc: 'บิตคอยน์',
      ethereum: 'อีเธอเรียม',
      eth: 'อีเธอเรียม',
      usdt: 'USDT',
    },
    words: {
      percent: 'เปอร์เซ็นต์',
      down: 'ลดลง',
      up: 'เพิ่มขึ้น',
      about: 'ประมาณ',
      and: 'และ',
      to: 'เป็น',
      rangeTo: 'ถึง',
      million: 'ล้าน',
      billion: 'พันล้าน',
    },
    units: {
      h: { one: 'ชั่วโมง', many: 'ชั่วโมง' },
      d: { one: 'วัน', many: 'วัน' },
      w: { one: 'สัปดาห์', many: 'สัปดาห์' },
      y: { one: 'ปี', many: 'ปี' },
    },
    months: [
      'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
    ],
    dateWithYear: '{day} {month} {year}',
    dateNoYear: '{day} {month}',
    buddhistEra: true,
    readback: {
      buy: 'ซื้อ{asset} {amount} {currency}.',
      sell: 'ขาย{asset} {amount} {currency}.',
      deposit: 'ฝากเงิน {amount} {currency}.',
      fee: 'ค่าธรรมเนียม {fee} {currency}.',
      total: 'รวมทั้งหมด {total} {currency}.',
      prompt: 'พูดว่า ยืนยัน หรือ ยกเลิก',
    },
    lines: {
      didntCatch: 'ขอโทษ ฟังไม่ทัน พูดว่า ยืนยัน หรือ ยกเลิก',
      cancelled: 'ยกเลิกแล้ว',
      goingBack: 'กลับไปหน้าก่อนหน้า',
      louder: 'ได้ เสียงดังขึ้นแล้ว ได้ยินชัดไหม',
      slower: 'ได้ จะพูดช้าลง',
      nothingToRepeat: 'ยังไม่มีอะไรให้พูดซ้ำ',
      longReplyPointer: 'ที่เหลืออ่านได้บนหน้าจอ',
      previewUnreadable: 'อ่านรายการนี้ออกเสียงไม่ได้ ช่วยดูการ์ดบนหน้าจอ',
    },
    pronunciations: {
      'U-topia': 'ยูโทเปีย',
    },
  },
};

/** Fill {placeholders} in a template. Unknown placeholders are left as they are. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}
