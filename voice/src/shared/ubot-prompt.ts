// A prompt for the real U-Bot (https://u.bot/), written from what the user is doing in the app. U-Bot has no public
// API and no deep link, so the handoff card shows this prompt with "Copy and open U-Bot": the user signs in there and
// pastes it. A good prompt saves them retyping, and tells U-Bot what they want done and how (review and pay in
// U-topia Pay, as U-Bot's own screens do).
//
// It carries the user's request and where they are in the app (the screen, the asset). Never balances, amounts
// on their account, or anything personal.
//
// A question about U-topia starts the way U-Bot's own "Ask U-Topia" mode starts its messages:
// "[Context: question is about U-Topia]".
//
// THAI REVIEW: the Thai templates.

import { destinationOf, mockKind } from '../config/ubot-mock';
import type { HandoffReason, Lang } from './types';

export interface UbotScenario {
  /** Where the user is, in words, e.g. "Gold page", "Home screen", "buy screen for Gold". */
  screen?: string;
  /** The asset on screen, if any, e.g. "Gold". */
  asset?: string;
}

const PAY = { en: 'then let me review and pay in U-topia Pay.', th: 'แล้วให้ฉันตรวจสอบและจ่ายใน U-topia Pay' } as const;

/** One line, no control characters, at most `max` characters. */
export function cleanLine(s: string | undefined, max = 200): string {
  return (s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
}

const QUESTION_START = /^(how|what|why|when|where|who|which|can|could|is|are|does|do|will|should)\b/i;

function asSentence(q: string): string {
  if (/[.?!]$/.test(q)) return q;
  return QUESTION_START.test(q) ? `${q}?` : `${q}.`;
}

export function buildUbotPrompt(question: string, reason: HandoffReason, lang: Lang, scenario: UbotScenario = {}): string {
  const q = cleanLine(question);
  if (!q) return '';
  const screen = cleanLine(scenario.screen, 60);
  const asset = cleanLine(scenario.asset, 40);
  const capital = q.charAt(0).toUpperCase() + q.slice(1);

  if (reason === 'utopia_question') {
    if (lang === 'th') {
      const where = screen ? ` ตอนนี้ฉันอยู่ที่${screen}ในแอปยูโทเปีย${asset && !screen.includes(asset) ? ` กำลังดู${asset}` : ''}` : '';
      return `[Context: question is about U-Topia] ${q}${where}`;
    }
    const where = screen ? ` I'm on the ${screen} in the U-topia app${asset && !screen.includes(asset) ? `, looking at ${asset}` : ''}.` : '';
    return `[Context: question is about U-Topia] ${asSentence(capital)}${where}`;
  }

  if (reason === 'general') return lang === 'th' ? q : asSentence(capital);

  // commerce: say what to do and how to pay, then the user's own words (dates, times and details stay intact)
  const place = destinationOf(q);
  const kind = mockKind(q, reason);
  if (lang === 'th') {
    const task = {
      ride: `ช่วยเรียกรถ${place ? `ไป${place}` : ''}ให้หน่อย ขอดูตัวเลือกพร้อมราคาและเวลารถมารับ`,
      flight: `ช่วยหาเที่ยวบิน${place ? `ไป${place}` : ''}ให้หน่อย ขอดูตัวเลือกพร้อมเวลาและราคา`,
      hotel: `ช่วยหาโรงแรม${place ? `ที่${place}` : ''}ให้หน่อย ขอดูตัวเลือกพร้อมราคา`,
      grocery: 'ช่วยสั่งของให้หน่อย ใส่ตะกร้าให้ก่อน',
      food: 'ช่วยสั่งอาหารให้หน่อย ขอดูตัวเลือกพร้อมราคาและเวลาส่ง',
      other: 'ช่วยจัดการเรื่องนี้ให้หน่อย ขอดูตัวเลือก',
    }[kind];
    return `${task} ${PAY.th}\nคำขอของฉัน: “${q}”`;
  }
  const task = {
    ride: `Book me a ride${place ? ` to ${place}` : ''}. Show me a few options with the price and pickup time,`,
    flight: `Find me flights${place ? ` to ${place}` : ''}. Show me a few options with times and prices,`,
    hotel: `Find me a hotel${place ? ` in ${place}` : ''}. Show me a few options with prices and what is included,`,
    grocery: 'Help me order groceries. Put them in a basket first,',
    food: 'Order food for me. Show me a few options with prices and delivery times,',
    other: 'Help me with this. Show me the options,',
  }[kind];
  return `${task} ${PAY.en}\nMy request: “${q}”`;
}
