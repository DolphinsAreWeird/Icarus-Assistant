// The "Ask U-topia" glossary. A MOCK of what U-Bot's U-topia mode would answer, until U-Bot has an API.
//
// IMPORTANT, read this before editing:
//  - Every answer here is built ONLY from what U-topia says publicly (u-topia.com, its blog) and from
//    our own context file. Nothing is invented. The `evidence` field says where each line comes from.
//  - Every entry is `verified: false`. Nobody at U-topia has checked these. The app labels them as mock.
//  - NO NUMBERS. No fees, rates, prices or dates. Hard rule 3: numbers come from data tools, never from text.
//    A test fails if an answer contains a digit, a currency sign or "percent".
//  - Answers only DEFINE a thing ("What is U-Coin?"). Anything more specific ("How do I...", fees,
//    "my payment failed") goes to U-Bot instead of being guessed.
//  - Keep answers to one or two short sentences. Icarus talks short and calm.
//
// When U-Bot has an API, set UTOPIA_MODE=http and this file is no longer used.
// Until then, the best upgrade is to ask U-Bot these questions yourself, check its answers, paste them here
// and set verified: true with `checkedBy` and `checkedOn`.
//
// THAI REVIEW: every `th` line is a first draft that a Thai speaker must check.

export interface GlossaryEntry {
  id: string;
  /** How people write it. Spaces and hyphens are optional when matching: "u-coin", "u coin", "ucoin". */
  terms: string[];
  en: string;
  th: string;
  /** Where the facts come from. */
  evidence: string;
  verified: boolean;
  checkedBy?: string;
  checkedOn?: string;
}

export const UTOPIA_GLOSSARY: GlossaryEntry[] = [
  {
    id: 'u-topia',
    terms: ['u-topia', 'utopia', 'ยูโทเปีย'],
    en: 'U-topia is an all-in-one finance app. It brings your digital assets, payments and cards together in one place.',
    th: 'ยูโทเปียเป็นแอปการเงินครบในที่เดียว รวมสินทรัพย์ดิจิทัล การชำระเงิน และบัตรไว้ด้วยกัน',
    evidence: 'u-topia.com homepage: "An all-in-one financial app that brings digital assets, payments and cross-chain access together."',
    verified: false,
  },
  {
    id: 'u-pay',
    terms: ['u-pay', 'ยูเพย์'],
    en: 'U-Pay is for payments across borders. U-topia says it avoids high exchange and transfer fees.',
    th: 'ยูเพย์ใช้จ่ายข้ามประเทศ ยูโทเปียบอกว่าเลี่ยงค่าแลกเปลี่ยนและค่าโอนที่สูง',
    evidence: 'u-topia.com homepage: "Borderless payments, no high FX or cross-border fees."',
    verified: false,
  },
  {
    id: 'u-card',
    terms: ['u-card', 'ยูการ์ด'],
    en: 'U-Card is the U-topia Visa card. There is a physical card and a virtual one.',
    th: 'ยูการ์ดคือบัตรวีซ่าของยูโทเปีย มีทั้งบัตรจริงและบัตรเสมือน',
    evidence: 'u-topia.com homepage: "The physical and virtual Visa card."',
    verified: false,
  },
  {
    id: 'u-coin',
    terms: ['u-coin', 'ยูคอยน์'],
    en: 'U-Coin is the native token of the U-topia ecosystem.',
    th: 'ยูคอยน์คือโทเคนประจำระบบนิเวศของยูโทเปีย',
    evidence: 'icarus context.md section 15: "U-Coin (native token)".',
    verified: false,
  },
  {
    id: 'u-wallet',
    terms: ['u-wallet', 'ยูวอลเล็ต'],
    en: 'U-Wallet is the U-topia wallet. U-topia describes it as gasless.',
    th: 'ยูวอลเล็ตคือกระเป๋าของยูโทเปีย ยูโทเปียบอกว่าไม่ต้องจ่ายค่าแก๊ส',
    evidence: 'icarus context.md section 15: "U-Wallet (gasless wallet)".',
    verified: false,
  },
  {
    id: 'u-center',
    terms: ['u-center', 'ยูเซ็นเตอร์'],
    en: 'U-center is the U-topia membership community. Members take part in a DAO, which is a group that votes together.',
    th: 'ยูเซ็นเตอร์คือชุมชนสมาชิกของยูโทเปีย สมาชิกร่วมใน DAO ซึ่งเป็นกลุ่มที่โหวตร่วมกัน',
    evidence: 'icarus context.md section 15: "U-center membership with DAO shares". u-topia.com/blog/u-center.',
    verified: false,
  },
  {
    id: 'topi-ai',
    terms: ['topi ai', 'topi', 'โทปี'],
    en: 'Topi AI is the U-topia AI assistant that lives in Telegram. It gives traders market insights.',
    th: 'โทปี เอไอ คือผู้ช่วย AI ของยูโทเปียบนเทเลแกรม ให้ข้อมูลตลาดแก่นักเทรด',
    evidence: 'icarus context.md sections 6 and 15 (Topi AI docs, Telegram assistant).',
    verified: false,
  },
  {
    id: 'u-bot',
    terms: ['u-bot', 'ยูบอท'],
    en: 'U-Bot is the U-topia AI assistant. It can answer questions and help prepare orders, and you review and pay in U-topia Pay.',
    th: 'ยูบอทคือผู้ช่วย AI ของยูโทเปีย ตอบคำถามและช่วยเตรียมคำสั่งซื้อ แล้วคุณตรวจสอบและจ่ายใน ยูโทเปีย เพย์',
    evidence: 'u.bot page text: "agentic payments", "Review & pay in U-topia Pay", "Ask anything about U-Topia".',
    verified: false,
  },
  {
    id: 'u-topia-pay',
    terms: ['u-topia pay', 'ยูโทเปีย เพย์', 'ยูโทเปียเพย์'],
    en: 'U-topia Pay is where you review and pay for orders that U-Bot prepares for you.',
    th: 'ยูโทเปีย เพย์ คือที่ที่คุณตรวจสอบและจ่ายเงินสำหรับคำสั่งซื้อที่ยูบอทเตรียมให้',
    evidence: 'u.bot page text: "Review & pay in U-topia Pay", "Open in U-topia Pay".',
    verified: false,
  },
];
