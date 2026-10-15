// Screens text that came from OUTSIDE (a real U-Bot answer, once it has an API) before Icarus says it.
// Our hard rules still apply to words we did not write:
//   rule 3: numbers come from data tools, never from an LLM  -> no digits, currency signs or "percent"
//   rule 1: no personal investment advice                     -> no "you should buy", no guarantees
// An answer that fails is not shown. The user is handed to U-Bot instead ("ask it there").
// The mock glossary goes through the same check (a test enforces it).

export type SafetyVerdict = { ok: true } | { ok: false; reason: 'empty' | 'numbers' | 'advice' | 'too_long' };

const NUMBERS = /\d|[%฿$€£¥]|\b(percent|per cent)\b|เปอร์เซ็นต์/i;
const ADVICE =
  /\b(you should (buy|sell|invest|hold|stake)|i (would )?(recommend|suggest|advise) (you )?(to )?(buy|sell|invest|stake|hold)|buy now|sell now|guaranteed|can'?t lose|risk[- ]free|will (go up|moon|double))\b|ควรซื้อ|ควรขาย|แนะนำให้ซื้อ|แนะนำให้ขาย|รับประกัน|ไม่มีความเสี่ยง/i;
const MAX_CHARS = 800;

export function checkAnswerSafe(answer: string): SafetyVerdict {
  const text = answer.trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > MAX_CHARS) return { ok: false, reason: 'too_long' };
  if (NUMBERS.test(text)) return { ok: false, reason: 'numbers' };
  if (ADVICE.test(text)) return { ok: false, reason: 'advice' };
  return { ok: true };
}
