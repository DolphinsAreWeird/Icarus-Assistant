// "Ask U-topia" and the handoff to U-Bot, inside Oasis's prototype.
//
// The prototype answers every request with its method demoRespond(text, ctx), for typed chat and for voice.
// We wrap that ONE method on the running instance (the prototype file is not edited):
//
//   1. ask our voice server /api/utopia/route what kind of request this is
//        answer  -> a question about U-topia ("What is U-Coin?"): answer it (mock glossary for now)
//        handoff -> something Icarus cannot do (travel, rides, groceries, drawing...): say so and show the U-Bot card
//        none    -> a normal in-app request: the prototype answers it exactly as before
//   2. if the prototype itself falls back to "I didn't catch that" on a real request, offer U-Bot instead of a dead end
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
  handoff?: { label: string; message: string; url: string; question: string; reason: string };
}

const THAI = /[฀-๿]/;
const SUGGESTIONS = ['Show me gold', 'What can you do?'];

type Responder = (q: string, ctx: unknown) => unknown;

/**
 * The routing itself: answer U-topia questions, hand off what Icarus cannot do, otherwise call `next`.
 * Used around the prototype's demo answers (installUtopiaRouting) and around the real backend (backend-bridge.ts).
 */
function makeRouter(options: UtopiaBridgeOptions, inst: PrototypeInstance) {
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const base = options.serverUrl ?? '';

  const askServer = async (text: string, language: 'en' | 'th', fallback = false): Promise<RouteReply> => {
    try {
      const res = await fetchImpl(`${base}/api/utopia/route`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, language, ...(fallback ? { fallback: true } : {}) }),
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

  return async (q: string, next: () => unknown): Promise<unknown> => {
    options.hideCard();
    const th = THAI.test(q) || inst.state?.lang === 'th';
    const language = th ? 'th' : 'en';

    const route = await askServer(q, language);
    if (route.kind === 'answer' && route.answer) {
      const source = route.source === 'u-bot' ? 'U-Bot' : 'Mock answer, not checked by U-topia yet';
      return reply(route.answer, { emo: 'happy', src: [source] });
    }
    if (route.kind === 'handoff' && route.handoff) return handoffReply(route.handoff, th);

    const answer = await next();
    // The prototype's dead end. A real request deserves a handoff, a misheard word does not.
    if (typeof (answer as { text?: unknown })?.text === 'string' && (answer as { text: string }).text.startsWith("I didn't catch that")) {
      const fallback = await askServer(q, language, true);
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
  const wrapped = (q: string, ctx: unknown): Promise<unknown> => route(q, () => original(q, ctx));
  (wrapped as unknown as { __utopia: boolean }).__utopia = true;
  inst.demoRespond = wrapped;
  return true;
}

/** The same routing around any other responder, for example the real backend. */
export function withUtopiaRouting(options: UtopiaBridgeOptions, responder: Responder): Responder {
  const inst = options.getInstance();
  if (!inst) return responder;
  const route = makeRouter(options, inst);
  return (q, ctx) => route(q, () => responder(q, ctx));
}
