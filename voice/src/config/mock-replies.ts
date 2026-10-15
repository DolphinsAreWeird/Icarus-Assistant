// Canned replies for the MOCK assistant. They only exist so the voice layer can be tested
// before the real assistant (Luka and First) is ready. Edit freely.
// THAI REVIEW: the Thai replies need a Thai speaker to check them.

import type { Lang } from '../shared/types';

export interface MockReplies {
  explain: string;
  navigate: string;
  /** Shown on screen next to the preview card. The spoken read-back is built from the card data instead. */
  previewText: string;
  refusal: string;
  fallback: string;
}

export const MOCK_REPLIES: Record<Lang, MockReplies> = {
  en: {
    // Percent as a symbol on purpose: it goes through the speech formatter like a real reply would.
    explain: "That red number is today's change. Gold is down 2.3% since yesterday.",
    navigate: 'Sure, taking you to {asset}.',
    previewText: "Here's your preview for {amount} baht of {asset}. Check the card, then confirm.",
    refusal:
      "I can't pick investments for you, but I can compare gold and Bitcoin on fees and past ups and downs. Want that?",
    fallback: 'I can explain what is on your screen, take you to an asset, or prepare a purchase. What would you like?',
  },
  th: {
    explain: 'ตัวเลขสีแดงคือการเปลี่ยนแปลงของวันนี้ ทองลดลง 2.3% จากเมื่อวาน',
    navigate: 'ได้เลย กำลังพาไปที่{asset}',
    previewText: 'นี่คือรายการซื้อ{asset} {amount} บาท ตรวจสอบการ์ด แล้วกดยืนยัน',
    refusal: 'ฉันเลือกการลงทุนให้ไม่ได้ แต่เปรียบเทียบทองกับบิตคอยน์เรื่องค่าธรรมเนียมและความผันผวนในอดีตให้ได้ ต้องการไหม',
    fallback: 'ฉันอธิบายสิ่งที่อยู่บนหน้าจอ พาไปที่สินทรัพย์ หรือเตรียมรายการซื้อให้ได้ ต้องการอะไร',
  },
};
