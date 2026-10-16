// "Ask U-topia" and the handoff to U-Bot, inside Oasis's prototype.
//
// The prototype answers every request with its method demoRespond(text, ctx), for typed chat and for voice.
// We wrap that ONE method on the running instance (the prototype file is not edited):
//
//   1. ask our voice server /api/utopia/route what kind of request this is
//        answer  -> a question about U-topia ("What is U-Coin?"): answer it (mock glossary for now)
//        handoff -> something Icarus cannot do (travel, rides, groceries, drawing...): say so and show the U-Bot card
//        none    -> a normal in-app request: the prototype answers it exactly as before
//   2. if the prototype itself falls back to "I didn't catch that" on a real request, offer U-Bot instead of a dead end;
//      but a finance question (S&P 500, interest rates...) is ours, so Icarus says plainly what it has instead
//
// If the voice server is down, everything falls through to the prototype's own answers. Nothing breaks.

import type { HandoffInfo } from './handoff-card';

export interface PrototypeInstance {
  demoRespond: (q: string, ctx: unknown) => unknown;
  /** The prototype's own reply builder: R(text, { say, emo, src, sugg, ui }). */
  R?: (text: string, o?: Record<string, unknown>) => unknown;
  log?: (type: string, data?: Record<string, unknown>) => void;
  state?: { lang?: string };
}

export interface UtopiaBridgeOptions {
  getInstance: () => PrototypeInstance | null;
  serverUrl?: string;
  showCard: (handoff: HandoffInfo, th: boolean) => void;
  hideCard: () => void;
  fetchImpl?: typeof fetch;
  /** The prototype shows a reply after a short delay. The card waits the same time. */
  cardDelayMs?: number;
}

interface RouteReply {
  kind: 'answer' | 'handoff' | 'none';
  answer?: string;
  source?: 'mock' | 'u-bot';
  verified?: boolean;
  handoff?: { label: string; message: string; url: string; question: string; reason: string; mock?: boolean; prompt?: string };
}

const THAI = /[฀-๿]/;

/**
 * Where the user is, in words, for the prompt Icarus writes for U-Bot: the screen and the asset on it, from the
 * prototype's own getContext(). Never balances or anything personal.
 */
export function scenarioOf(ctx: unknown, th: boolean): { screen?: string; asset?: string } {
  const c = (ctx ?? {}) as { screen?: string; asset?: { name?: string } };
  const asset = typeof c.asset?.name === 'string' ? c.asset.name : undefined;
  // THAI REVIEW: the Thai screen names.
  const en: Record<string, string> = { home: 'Home screen', wallets: 'Wallets screen', payments: 'Payments screen', card: 'Card screen', invest: 'Invest screen', portfolio: 'Portfolio screen' };
  const thai: Record<string, string> = { home: 'หน้าหลัก', wallets: 'หน้ากระเป๋าเงิน', payments: 'หน้าการชำระเงิน', card: 'หน้าบัตร', invest: 'หน้าการลงทุน', portfolio: 'หน้าพอร์ต' };
  let screen: string | undefined;
  if (c.screen === 'asset' && asset) screen = th ? `หน้า ${asset}` : `${asset} page`;
  else if (c.screen === 'buy' && asset) screen = th ? `หน้าซื้อ ${asset}` : `buy screen for ${asset}`;
  else if (c.screen) screen = (th ? thai : en)[c.screen];
  return { ...(screen ? { screen } : {}), ...(c.screen === 'asset' || c.screen === 'buy' ? (asset ? { asset } : {}) : {}) };
}

/** Markets and money: if the prototype cannot answer one of these, it is not U-Bot's job either. */
const FINANCE = /s&p|\bsp ?500\b|nasdaq|dow jones|\bdow\b|\bindex\b|indices|stocks?\b|shares?\b|\betf|\bfunds?\b|bonds?\b|interest rate|inflation|forex|exchange rate|currency|\bmarket|\bprice|\bcrypto|\bcoin|\btoken|dividend|portfolio|invest|ราคา|หุ้น|ดัชนี|ตลาด|กองทุน|ดอกเบี้ย|ค่าเงิน|ลงทุน|พันธบัตร/i;

// THAI REVIEW: the Thai line.
const NO_DATA = {
  en: "I don't have data for that in this app, so I won't guess a number. I can show prices and charts for the assets in this app, explain anything on your screen, or set up a buy.",
  th: 'ในแอปนี้ยังไม่มีข้อมูลเรื่องนั้น ฉันจะไม่เดาตัวเลข ฉันช่วยดูราคาและกราฟของสินทรัพย์ในแอปนี้ อธิบายอะไรก็ได้บนหน้าจอ หรือเตรียมการซื้อให้ได้',
} as const;
const SUGGESTIONS = ['Show me gold', 'What can you do?'];

type Responder = (q: string, ctx: unknown) => unknown;

/**
 * The routing itself: answer U-topia questions, hand off what Icarus cannot do, otherwise call `next`.
 * Used around the prototype's demo answers (installUtopiaRouting) and around the real backend (backend-bridge.ts).
 */
function makeRouter(options: UtopiaBridgeOptions, inst: PrototypeInstance) {
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const base = options.serverUrl ?? '';

  const askServer = async (text: string, language: 'en' | 'th', fallback = false, context: { screen?: string; asset?: string } = {}): Promise<RouteReply> => {
    try {
      const res = await fetchImpl(`${base}/api/utopia/route`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, language, ...(fallback ? { fallback: true } : {}), ...(Object.keys(context).length ? { context } : {}) }),
        ...(typeof AbortSignal.timeout === 'function' ? { signal: AbortSignal.timeout(6000) } : {}),
      });
      return res.ok ? ((await res.json()) as RouteReply) : { kind: 'none' };
    } catch {
      return { kind: 'none' }; // server down or slow: the prototype answers by itself
    }
  };

  const reply = (text: string, extra: { emo: string; src: string[] }) =>
    inst.R ? inst.R(text, { say: text, emo: extra.emo, src: extra.src, sugg: SUGGESTIONS }) : { text, speech: text, emotion: extra.emo, speak: true, ui_actions: [], sources: extra.src, suggestions: SUGGESTIONS, offer: null };

  const handoffReply = (h: NonNullable<RouteReply['handoff']>, th: boolean) => {
    inst.log?.('handoff', { target: 'u-bot', reason: h.reason, question: h.question }); // shows up as friction for the business
    window.setTimeout(() => options.showCard(h, th), options.cardDelayMs ?? 650);
    return reply(h.message, { emo: 'curious', src: ['Handed off to U-Bot'] });
  };

  return async (q: string, ctx: unknown, next: () => unknown): Promise<unknown> => {
    options.hideCard();
    const th = THAI.test(q) || inst.state?.lang === 'th';
    const language = th ? 'th' : 'en';
    const context = scenarioOf(ctx, th);

    const route = await askServer(q, language, false, context);
    if (route.kind === 'answer' && route.answer) {
      const source = route.source === 'u-bot' ? 'U-Bot' : 'Mock answer, not checked by U-topia yet';
      return reply(route.answer, { emo: 'happy', src: [source] });
    }
    if (route.kind === 'handoff' && route.handoff) return handoffReply(route.handoff, th);

    const answer = await next();
    // The prototype's dead end. A real request deserves a handoff, a misheard word does not.
    if (typeof (answer as { text?: unknown })?.text === 'string' && (answer as { text: string }).text.startsWith("I didn't catch that")) {
      // A finance question we have no data for: say so, honestly, with what Icarus can do. Never a made-up number.
      if (FINANCE.test(q)) {
        inst.log?.('no_data', { question: q }); // the friction map shows what people wanted that the app lacks
        return reply(NO_DATA[th ? 'th' : 'en'], { emo: 'thinking', src: ["Not in this app's data"] });
      }
      const fallback = await askServer(q, language, true, context);
      if (fallback.kind === 'handoff' && fallback.handoff) return handoffReply(fallback.handoff, th);
    }
    return answer;
  };
}

export function installUtopiaRouting(options: UtopiaBridgeOptions): boolean {
  const inst = options.getInstance();
  if (!inst || typeof inst.demoRespond !== 'function') return false;
  if ((inst.demoRespond as { __utopia?: boolean }).__utopia) return true; // already installed
  const original = inst.demoRespond.bind(inst);
  const route = makeRouter(options, inst);
  const wrapped = (q: string, ctx: unknown): Promise<unknown> => route(q, ctx, () => original(q, ctx));
  (wrapped as unknown as { __utopia: boolean }).__utopia = true;
  inst.demoRespond = wrapped;
  return true;
}

/** The same routing around any other responder, for example the real backend. */
export function withUtopiaRouting(options: UtopiaBridgeOptions, responder: Responder): Responder {
  const inst = options.getInstance();
  if (!inst) return responder;
  const route = makeRouter(options, inst);
  return (q, ctx) => route(q, ctx, () => responder(q, ctx));
}
