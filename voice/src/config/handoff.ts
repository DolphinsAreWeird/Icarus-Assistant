// When Icarus hands a request to U-Bot, and what it says. Edit freely.
//
// WHEN WE HAND OFF
//   commerce  : travel, rides, grocery orders. U-Bot's own screens show "Review & pay in U-topia Pay" for
//               flights, hotels, rides and groceries, so that is where those go.
//   general   : drawing, writing, building apps, translating, weather and so on. Not a finance-app job.
//   utopia_question : a question about U-topia that the glossary cannot answer.
// WHEN WE DO NOT
//   Advice ("what should I buy?"). Icarus refuses that itself (hard rule 1) and never passes it to another bot.
//
// THAI REVIEW: the Thai words below are a first draft.

import type { HandoffReason } from '../shared/types';

/** U-Bot has no public deep link (we looked), so the button goes to its front door. It needs a login. */
export const DEFAULT_UBOT_URL = 'https://u.bot/';

export const HANDOFF_COPY: Record<'en' | 'th', { label: string; messages: Record<HandoffReason, string> }> = {
  en: {
    label: 'Open U-Bot',
    messages: {
      utopia_question: "I don't have the details on that one. U-Bot can answer questions about U-topia. I've written the question for you.",
      commerce: "That's outside what I can do in this app. U-Bot can help with travel, rides and grocery orders, and you review and pay in U-topia Pay. I've written the request for you.",
      general: "I can't help with that here. U-Bot is a general assistant, so it may be able to. I've written the request for you.",
    },
  },
  th: {
    label: 'เปิด U-Bot',
    messages: {
      // THAI REVIEW: "I've written the question/request for you" at the end.
      utopia_question: 'เรื่องนี้ฉันยังไม่มีรายละเอียด U-Bot ตอบคำถามเกี่ยวกับยูโทเปียได้ ฉันเขียนคำถามไว้ให้แล้ว',
      commerce: 'เรื่องนี้เกินกว่าที่ฉันทำได้ในแอปนี้ U-Bot ช่วยเรื่องเดินทาง เรียกรถ และสั่งของได้ แล้วคุณตรวจสอบและจ่ายใน U-topia Pay ฉันเขียนคำขอไว้ให้แล้ว',
      general: 'เรื่องนี้ฉันช่วยในแอปนี้ไม่ได้ U-Bot เป็นผู้ช่วยทั่วไป อาจช่วยได้ ฉันเขียนคำขอไว้ให้แล้ว',
    },
  },
};

// ---- Routing words. Matched against the lowercased request. ----

/** Advice seeking. Never handed off. */
export const ADVICE = /\b(should i|shall i|recommend|which (one )?(is )?(better|best)|best (coin|asset|investment|token|stock)|good time to|worth buying|is it safe to)\b|ควร|แนะนำ|ดีที่สุด/i;

/** Words that make a question about investing. Used to tell "recommend a hotel" from "recommend a coin". */
export const INVESTING =
  /\b(invest|investing|investment|investments|stock|stocks|shares?|coins?|tokens?|crypto|bitcoin|btc|ethereum|eth|gold|usdt|etf|funds?|portfolio|yield|staking|swap)\b|ลงทุน|หุ้น|ทอง|บิตคอยน์|คริปโต|เหรียญ|พอร์ต/i;

/** Travel, rides, groceries. */
export const COMMERCE =
  /\b(flights?|airfares?|airlines?|plane tickets?|hotels?|hostels?|book (me )?(a |an )?(room|trip|table|flight|hotel|ticket)|uber|taxi|cab|grab car|rides?|groceries|grocery|ingredients|food delivery|order (me )?(food|dinner|lunch|pizza|groceries|a pizza))\b|ตั๋วเครื่องบิน|เที่ยวบิน|จองโรงแรม|โรงแรม|แท็กซี่|เรียกรถ|ซื้อของ|วัตถุดิบ|สั่งอาหาร/i;

/** Not a finance-app job. */
export const GENERAL =
  /\b(draw|sketch|paint|picture of|image of|photo of|logo|write (me )?(a|an|the) (essay|poem|story|letter|email|report|document|speech|cover letter|blog)|build (me )?(a|an) (app|game|website|landing page|tool)|make (me )?(a|an) (app|game|website)|translate|weather|tell me a joke|joke|recipe|homework|write code|code (a|an|the))\b|วาดรูป|เขียนจดหมาย|เขียนอีเมล|แปลภาษา|อากาศ|เล่าเรื่องตลก|สูตรอาหาร|การบ้าน|สร้างเว็บ|สร้างแอป/i;
