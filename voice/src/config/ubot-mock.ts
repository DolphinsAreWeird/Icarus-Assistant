// SAMPLE DATA for the U-Bot mock (UBOT_MODE=mock). Not real services, not real prices: the mock page says so.
// U-Bot's own screens show "Review & pay in U-topia Pay" cards for flights, hotels, rides and groceries, so the mock
// shows the same kind of step. Replace all of this with real U-Bot calls once U-topia shares an API.
//
// THAI REVIEW: the Thai lines.

import type { HandoffReason, Lang } from '../shared/types';

export type MockKind = 'ride' | 'flight' | 'hotel' | 'grocery' | 'food' | 'other';

export interface MockOption {
  title: string;
  detail: string;
  /** Sample price in baht. Shown with a "sample" label. */
  priceThb: number;
}

const KIND_RULES: Array<[MockKind, RegExp]> = [
  ['ride', /\b(rides?|taxi|cab|uber|grab car|car to)\b|เรียกรถ|แท็กซี่/i],
  ['flight', /\b(flights?|plane|airfares?|airlines?)\b|ตั๋วเครื่องบิน|เที่ยวบิน/i],
  ['hotel', /\b(hotels?|hostels?|room)\b|โรงแรม/i],
  ['grocery', /\b(groceries|grocery|ingredients)\b|ซื้อของ|วัตถุดิบ/i],
  ['food', /\b(food|dinner|lunch|pizza)\b|สั่งอาหาร/i],
];

export function mockKind(question: string, reason: HandoffReason): MockKind {
  if (reason !== 'commerce') return 'other';
  return KIND_RULES.find(([, re]) => re.test(question))?.[0] ?? 'other';
}

/**
 * Where to: "a flight to phuket tomorrow" -> "Phuket", "a ride to the airport" -> "the airport",
 * "hotels in krabi" -> "Krabi". Null when there is no clear place.
 */
export function destinationOf(question: string): string | null {
  for (const word of ['to', 'in']) {
    const parts = question.split(new RegExp(`\\b${word}\\b`, 'i'));
    if (parts.length < 2) continue;
    const tail = (parts.at(-1) ?? '').split(/\s+(?:on|at|for|tomorrow|today|tonight|next|this|please)\b|[?.!,]/i)[0]?.trim() ?? '';
    if (/^[a-z][a-z .'-]{1,30}$/i.test(tail) && !/^(?:the\s+)?(?:book|order|buy|get|go|me|it|a|an)$/i.test(tail)) {
      return /^the\s/i.test(tail) ? tail.toLowerCase() : tail.replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }
  const th = /ไป(?:ที่)?\s*([฀-๿]{2,20})/.exec(question);
  return th?.[1] ?? null;
}

const OPTIONS: Record<Exclude<MockKind, 'other'>, Record<Lang, MockOption[]>> = {
  ride: {
    en: [
      { title: 'Economy car', detail: '4 seats · arrives in about 6 minutes', priceThb: 420 },
      { title: 'Comfort car', detail: '4 seats · newer car · about 4 minutes', priceThb: 560 },
      { title: 'Van', detail: '6 seats · room for bags · about 9 minutes', priceThb: 690 },
    ],
    th: [
      { title: 'รถประหยัด', detail: '4 ที่นั่ง · มาถึงในราว 6 นาที', priceThb: 420 },
      { title: 'รถสบาย', detail: '4 ที่นั่ง · รถใหม่ · ราว 4 นาที', priceThb: 560 },
      { title: 'รถตู้', detail: '6 ที่นั่ง · มีที่วางกระเป๋า · ราว 9 นาที', priceThb: 690 },
    ],
  },
  flight: {
    en: [
      { title: 'Morning flight', detail: 'Leaves 07:10 · arrives 08:35 · 1 bag', priceThb: 1890 },
      { title: 'Afternoon flight', detail: 'Leaves 13:40 · arrives 15:05 · 1 bag', priceThb: 2350 },
    ],
    th: [
      { title: 'เที่ยวบินเช้า', detail: 'ออก 07:10 · ถึง 08:35 · กระเป๋า 1 ใบ', priceThb: 1890 },
      { title: 'เที่ยวบินบ่าย', detail: 'ออก 13:40 · ถึง 15:05 · กระเป๋า 1 ใบ', priceThb: 2350 },
    ],
  },
  hotel: {
    en: [
      { title: 'Beachfront hotel', detail: '2 nights · breakfast included', priceThb: 4800 },
      { title: 'City hotel', detail: '2 nights · near the train', priceThb: 2900 },
    ],
    th: [
      { title: 'โรงแรมริมหาด', detail: '2 คืน · รวมอาหารเช้า', priceThb: 4800 },
      { title: 'โรงแรมในเมือง', detail: '2 คืน · ใกล้รถไฟฟ้า', priceThb: 2900 },
    ],
  },
  grocery: {
    en: [
      { title: 'Weekly basics', detail: '12 items: rice, eggs, milk, vegetables...', priceThb: 860 },
      { title: 'Fresh fruit box', detail: 'Mango, pineapple, bananas', priceThb: 390 },
    ],
    th: [
      { title: 'ของใช้ประจำสัปดาห์', detail: '12 รายการ: ข้าว ไข่ นม ผัก...', priceThb: 860 },
      { title: 'กล่องผลไม้สด', detail: 'มะม่วง สับปะรด กล้วย', priceThb: 390 },
    ],
  },
  food: {
    en: [
      { title: 'Pad kra pao set', detail: 'With fried egg and a drink · about 30 minutes', priceThb: 145 },
      { title: 'Large pizza', detail: 'Delivered in about 35 minutes', priceThb: 399 },
    ],
    th: [
      { title: 'ชุดผัดกะเพรา', detail: 'ไข่ดาวและเครื่องดื่ม · ราว 30 นาที', priceThb: 145 },
      { title: 'พิซซ่าถาดใหญ่', detail: 'ส่งถึงในราว 35 นาที', priceThb: 399 },
    ],
  },
};

const INTRO: Record<Lang, Record<MockKind, (place: string | null) => string>> = {
  en: {
    ride: (p) => `Here are rides${p ? ` to ${p}` : ''}. Pick one, then review and pay in U-topia Pay.`,
    flight: (p) => `Here are flights${p ? ` to ${p}` : ''}. Pick one, then review and pay in U-topia Pay.`,
    hotel: (p) => `Here are hotels${p ? ` in ${p}` : ''}. Pick one, then review and pay in U-topia Pay.`,
    grocery: () => 'Here are two baskets. Pick one, then review and pay in U-topia Pay.',
    food: () => 'Here is what is close by. Pick one, then review and pay in U-topia Pay.',
    other: () => "The real U-Bot would take it from here. This mock can't do that part yet.",
  },
  th: {
    ride: (p) => `นี่คือรถ${p ? `ไป${p}` : ''} เลือกหนึ่งคัน แล้วตรวจสอบและจ่ายใน U-topia Pay`,
    flight: (p) => `นี่คือเที่ยวบิน${p ? `ไป${p}` : ''} เลือกหนึ่งเที่ยว แล้วตรวจสอบและจ่ายใน U-topia Pay`,
    hotel: (p) => `นี่คือโรงแรม${p ? `ที่${p}` : ''} เลือกหนึ่งแห่ง แล้วตรวจสอบและจ่ายใน U-topia Pay`,
    grocery: () => 'นี่คือตะกร้าสินค้าสองแบบ เลือกหนึ่งแบบ แล้วตรวจสอบและจ่ายใน U-topia Pay',
    food: () => 'นี่คือร้านใกล้ ๆ เลือกหนึ่งอย่าง แล้วตรวจสอบและจ่ายใน U-topia Pay',
    other: () => 'U-Bot ตัวจริงจะทำต่อจากตรงนี้ ส่วนนี้ตัวจำลองยังทำไม่ได้',
  },
};

export interface MockReply {
  kind: MockKind;
  text: string;
  options: MockOption[];
  /** Always true: say on screen that these are samples. */
  sample: true;
}

export function mockReply(question: string, reason: HandoffReason, lang: Lang): MockReply {
  const kind = mockKind(question, reason);
  const place = destinationOf(question);
  return { kind, text: INTRO[lang][kind](place), options: kind === 'other' ? [] : OPTIONS[kind][lang], sample: true };
}
