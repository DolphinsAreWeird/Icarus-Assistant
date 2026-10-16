// Connects Oasis's prototype to Luka and First's backend (backend/, POST /chat), through the prototype's own hook
// Icarus.setBackend(fn). Opt in by opening the app with ?backend (http://localhost:8000) or ?backend=<url>,
// and ?user=u_small to switch the demo user (default u_new). Without it nothing changes: the demo answers run.
//
// The backend speaks the prototype's language (backend/app/ui.py, backend/data/app_ui.json):
//   - we send the prototype's own getContext() as `snapshot`; the backend reads the screen, asset and numbers from it
//   - it answers with screen actions from a closed list. The prototype's own ones (SCREEN_ACTIONS) pass straight
//     through; highlight comes as { element_id } and is renamed to the prototype's { target }
//   - and with at most one card: a trade preview, a chart, or step-by-step instructions. The prototype's chat cannot
//     draw them, so we show them over the phone (trade-card.ts, chat-cards.ts)
//
// A buy comes as a trade preview card with the backend's numbers, and Icarus reads it back EXACTLY from that card
// (hard rule 3). The user taps Confirm on the card (hard rule 4). An older backend drove the prototype's own buy
// screens instead; for that, the read-back comes from the prototype's own calc(), what its review screen shows.

import { withReadbackFields } from '../../voice/src/shared/backend-card';
import { buildReadback, parsePreview } from '../../voice/src/shared/readback';
import { STRINGS } from '../../voice/src/config/strings';

export const DEFAULT_BACKEND_URL = 'http://localhost:8000';

/** Screen actions the prototype runs (its doAction, and start_guide). Anything else the backend sends is not passed on. */
export const SCREEN_ACTIONS = new Set(['navigate', 'back', 'open_asset', 'set_period', 'set_filter', 'toggle_freeze', 'hide_balance', 'start_guide', 'start_buy', 'type_amount', 'select_wallet', 'review', 'cancel_buy']);
export const DEFAULT_USER = 'u_new';
const THAI = /[฀-๿]/;

/** What the prototype's getContext() returns (only the parts we use). Sent whole as the snapshot. */
export interface PrototypeContext {
  screen?: string;
  language?: string;
  asset?: { id?: string; name?: string };
  focus?: string;
  [key: string]: unknown;
}

export interface BackendReply {
  text: string;
  speech?: string;
  emotion?: string;
  suggestions?: string[];
  speak?: boolean;
  ui_actions?: Array<Record<string, unknown>>;
  sources?: Array<Record<string, unknown>>;
}

/** The reply shape the prototype renders (its own R() builder makes the same). */
export interface PrototypeReply {
  text: string;
  speech: string;
  emotion: string;
  speak: boolean;
  ui_actions: Array<Record<string, unknown>>;
  sources: string[];
  suggestions: string[];
  offer: null;
}

/** The prototype's own purchase calculator: calc(assetId, amountThb, walletId). */
export type PrototypeCalc = (asset: string, amount: number, wallet: string) => { amt: number; fee: number; total: number; ok: boolean };

export interface PrototypeLike {
  state?: { asst?: string; assetId?: string; walletId?: string };
  calc?: PrototypeCalc;
  /** The prototype's own scripted answers. Used when the backend does not answer, so the demo never dead-ends. */
  demoRespond?: (q: string, ctx: unknown) => unknown;
  /** The prototype's own "explain this" answer for a tapped element. */
  rExplain?: (elementId: string, th: boolean) => unknown;
}

/** Our data ids to the prototype's asset ids (backend/data/app_ui.json). */
const PROTOTYPE_ASSETS: Record<string, string> = { gold: 'XAU', btc: 'BTC', eth: 'ETH', xau: 'XAU' };

/**
 * A buy from the backend's trade card, done on the prototype's OWN buy screens: open the asset, start the buy,
 * type the amount, pick the wallet, stop on the review screen. Then what is on screen, what Icarus says (the
 * prototype's calc) and the demo's stopwatch (it stops on the app's own Confirm purchase) all agree.
 * Null when the prototype cannot do it (a sale, an asset it does not have, no calculator).
 */
export function buyOnAppScreens(card: Record<string, unknown>, proto: PrototypeLike | null): Array<Record<string, unknown>> | null {
  if (card.side !== 'buy' || typeof proto?.calc !== 'function') return null;
  const asset = PROTOTYPE_ASSETS[String(card.asset_id ?? '').toLowerCase()];
  const amount = Number(card.amount_thb);
  if (!asset || !Number.isFinite(amount) || amount <= 0) return null;
  return [
    { type: 'start_buy', asset },
    { type: 'type_amount', value: amount },
    { type: 'select_wallet', wallet: 'thb' },
    { type: 'review' },
  ];
}

/** ?backend, ?backend=<url> and ?user=<id> from the page address. Null when the backend is not switched on. */
export function backendFromLocation(search: string): { url: string; userId: string } | null {
  const q = new URLSearchParams(search);
  if (!q.has('backend')) return null;
  const raw = (q.get('backend') ?? '').trim();
  let url = DEFAULT_BACKEND_URL;
  if (raw && raw !== '1') {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      url = parsed.origin + parsed.pathname.replace(/\/+$/, '');
    } catch {
      return null;
    }
  }
  const user = (q.get('user') ?? '').trim();
  return { url, userId: /^[\w-]{1,40}$/.test(user) ? user : DEFAULT_USER };
}

export function langOf(text: string, ctx?: PrototypeContext): 'en' | 'th' {
  return THAI.test(text) || ctx?.language === 'th' ? 'th' : 'en';
}

/** The backend's ChatRequest (backend/app/contracts.py): the prototype's context goes as the snapshot, untouched. */
export function toChatRequest(text: string, ctx: PrototypeContext | undefined, o: { sessionId: string; userId: string; voice: boolean }) {
  return {
    session_id: o.sessionId,
    user_id: o.userId,
    text,
    lang: langOf(text, ctx),
    input_mode: o.voice ? 'voice' : 'text',
    ...(ctx ? { snapshot: ctx } : {}),
  };
}

/** "get_prices · binance + frankfurter (live)", once each. */
function sourceLabels(sources: Array<Record<string, unknown>> = []): string[] {
  const labels = sources.map((s) => `${String(s.tool ?? 'data')} · ${String(s.provider ?? '')}${s.freshness && s.freshness !== 'n/a' ? ` (${String(s.freshness)})` : ''}`);
  return [...new Set(labels)];
}

/**
 * The exact read-back for a buy the actions set up, from the prototype's own calculator: what the review screen
 * will show. Null when the actions are not a complete buy, or the prototype would refuse it (minimum, balance).
 */
export function buyReadback(actions: Array<Record<string, unknown>>, ctx: PrototypeContext | undefined, proto: PrototypeLike | null, lang: 'en' | 'th'): string | null {
  const typed = actions.find((a) => a.type === 'type_amount');
  if (!typed || !actions.some((a) => a.type === 'review') || typeof proto?.calc !== 'function') return null;
  const started = actions.find((a) => a.type === 'start_buy' || a.type === 'open_asset');
  const asset = String(started?.asset ?? ctx?.asset?.id ?? proto.state?.assetId ?? '');
  const wallet = String(actions.find((a) => a.type === 'select_wallet')?.wallet ?? proto.state?.walletId ?? 'thb');
  const amount = Number(typed.value);
  if (!asset || !Number.isFinite(amount)) return null;
  let c: ReturnType<PrototypeCalc>;
  try {
    c = proto.calc(asset, amount, wallet);
  } catch {
    return null;
  }
  if (!c?.ok) return null;
  const preview = parsePreview({ preview_id: 'screen', side: 'buy', asset: asset.toLowerCase(), amount: c.amt, fee: c.fee, total: c.total, currency: 'THB' });
  return preview ? `${buildReadback(preview, lang, { prompt: false })} ${STRINGS[lang].lines.tapConfirmPurchase}` : null;
}

/** One backend screen action in the prototype's shape, or null when the prototype cannot run it. */
export function toPrototypeAction(a: Record<string, unknown>): Record<string, unknown> | null {
  if (a.type === 'highlight' && typeof a.element_id === 'string') return { type: 'highlight', target: a.element_id };
  if (a.type === 'highlight' && typeof a.target === 'string') return a;
  return SCREEN_ACTIONS.has(String(a.type)) ? a : null;
}

export interface ReplyCards {
  /** A trade preview, with amount, fee and total added so they add up (backend-card.ts). */
  trade: Record<string, unknown> | null;
  chart: Record<string, unknown> | null;
  steps: Record<string, unknown> | null;
}

/**
 * The backend's reply as the prototype's: screen actions pass through, the card comes back separately, and the
 * spoken line is the exact read-back for a buy (from the trade card, or from the prototype's own calculator).
 */
export function toPrototypeReply(r: BackendReply, lang: 'en' | 'th', ctx?: PrototypeContext, proto: PrototypeLike | null = null): { reply: PrototypeReply } & ReplyCards {
  const actions: Array<Record<string, unknown>> = [];
  const cards: ReplyCards = { trade: null, chart: null, steps: null };
  for (const a of r.ui_actions ?? []) {
    if (!a || typeof a.type !== 'string') continue;
    if (a.type === 'card') {
      const data = a.data && typeof a.data === 'object' ? (a.data as Record<string, unknown>) : null;
      if (!data) continue;
      if (a.card_type === 'trade_preview') cards.trade = withReadbackFields(data);
      else if (a.card_type === 'chart') cards.chart = data;
      else if (a.card_type === 'steps') cards.steps = data;
      continue;
    }
    const action = toPrototypeAction(a);
    if (action) actions.push(action);
  }
  // A buy goes through the app's own screens when it can (see buyOnAppScreens); the card is then not shown.
  // With ?backend, demo-data.ts makes those screens use the backend's account and fee, so it all agrees.
  const onScreens = cards.trade ? buyOnAppScreens(cards.trade, proto) : null;
  if (onScreens) {
    actions.push(...onScreens);
    cards.trade = null;
  }
  let speech = buyReadback(actions, ctx, proto, lang) ?? r.speech ?? r.text;
  const preview = cards.trade ? parsePreview(cards.trade) : null;
  if (preview) speech = `${buildReadback(preview, lang, { prompt: false })} ${STRINGS[lang].lines.tapToConfirm}`;
  return {
    reply: {
      text: r.text,
      speech,
      emotion: r.emotion ?? (cards.trade || actions.some((a) => a.type === 'review') ? 'excited' : cards.chart || cards.steps ? 'curious' : 'happy'),
      speak: r.speak ?? true,
      ui_actions: actions,
      sources: sourceLabels(r.sources),
      suggestions: r.suggestions ?? [],
      offer: null,
    },
    ...cards,
  };
}

const COPY = {
  en: { unreachable: "I can't reach the Icarus brain right now. Is the backend running?", failed: "I couldn't answer just now. Try again." },
  th: { unreachable: 'ตอนนี้ติดต่อสมองของ Icarus ไม่ได้ เปิด backend อยู่หรือเปล่า', failed: 'ตอนนี้ตอบไม่ได้ ลองอีกครั้งนะ' },
} as const;

function plainReply(text: string, source: string): PrototypeReply {
  return { text, speech: text, emotion: 'thinking', speak: true, ui_actions: [], sources: [source], suggestions: [], offer: null };
}

// When the backend can't answer, what still works, offered instead of a dead end (plain requests need no AI).
const STILL_WORKS = {
  en: { text: "Sorry, I can't answer that one right now. I can still show prices, open an asset or set up a buy for you.",
    chips: ['How is gold doing?', 'Show me gold', 'Put 1,000 baht in gold'] },
  // THAI REVIEW
  th: { text: 'ขอโทษนะ ตอนนี้ตอบเรื่องนี้ไม่ได้ แต่ยังดูราคา เปิดหน้าสินทรัพย์ หรือเตรียมรายการซื้อให้ได้นะ',
    chips: ['ทองวันนี้เป็นยังไง', 'ดูทองคำ', 'ซื้อทองคำ 1000 บาท'] },
} as const;

/**
 * Whether the prototype's own scripted answer may stand in for the backend's. Only a plain screen move: its answers
 * with numbers come from the design's sample data (dollars, a different account), which would contradict the screen,
 * and its "didn't catch that" is a dead end.
 */
export function scriptedAnswerIsSafe(text: string): boolean {
  return !/[$฿€£¥]|\d|baht|บาท|percent|เปอร์เซ็นต์/i.test(text) && !/didn.t catch|ไม่เข้าใจ|ฟังไม่ทัน/i.test(text);
}

export interface BackendBridgeOptions {
  url: string;
  userId: string;
  getInstance: () => PrototypeLike | null;
  ready?: () => boolean;
  /** Put the U-topia routing around the backend (withUtopiaRouting). */
  wrap?: (fn: (q: string, ctx: unknown) => Promise<PrototypeReply>) => (q: string, ctx: unknown) => unknown;
  showTrade: (card: Record<string, unknown>, lang: 'en' | 'th') => void;
  showChart?: (card: Record<string, unknown>, lang: 'en' | 'th') => void;
  showSteps?: (card: Record<string, unknown>, lang: 'en' | 'th') => void;
  /** Take down any card from the last reply. */
  hideCards: () => void;
  fetchImpl?: typeof fetch;
  /** A card appears after the reply bubble. */
  cardDelayMs?: number;
  /** Give up on the backend after this long and use the demo answer. Default 25 s. */
  timeoutMs?: number;
}

/** Hand the prototype's questions to the backend. Returns false if the prototype has not mounted yet. */
export function installBackend(o: BackendBridgeOptions): boolean {
  const icarus = (window as unknown as { Icarus?: { setBackend?: (fn: unknown) => void; getContext?: () => PrototypeContext } }).Icarus;
  if (!icarus?.setBackend) return false;
  const fetchImpl = o.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const sessionId = `app-${Date.now().toString(36)}`;
  let generation = 0;

  const ask = async (text: string, rawCtx: unknown): Promise<PrototypeReply> => {
    const turn = ++generation;
    o.hideCards();
    const ctx = (rawCtx ?? undefined) as PrototypeContext | undefined;
    const lang = langOf(text, ctx);
    if (o.ready && !o.ready()) return plainReply(lang === 'th' ? 'รอโหลดบัญชีสาธิตก่อน แล้วลองอีกครั้ง' : 'Wait for the demo account to load, then try again.', 'Demo account loading');
    const proto = o.getInstance();
    const voice = proto?.state?.asst === 'voice';
    // When the backend cannot answer (down, no model, busy, too slow): a plain screen move from the prototype's own
    // scripted answers, labelled; anything else gets an honest reply with three things that still work, never the
    // design's sample numbers. Without the prototype, say what went wrong.
    const fallback = async (why: string, message: string): Promise<PrototypeReply> => {
      console.info(`[icarus] the backend did not answer (${why})`);
      if (typeof proto?.demoRespond === 'function') {
        try {
          // A tapped element ("explain this") gets the prototype's own explanation, as in its demo mode.
          const demo = (await (ctx?.focus && typeof proto.rExplain === 'function' ? proto.rExplain(ctx.focus, lang === 'th') : proto.demoRespond(text, rawCtx))) as PrototypeReply | null;
          if (demo && typeof demo.text === 'string' && scriptedAnswerIsSafe(demo.text)) {
            return { ...demo, sources: [...(demo.sources ?? []), 'Scripted demo answer'] };
          }
        } catch {
          // fall through to the honest reply
        }
        const still = STILL_WORKS[lang];
        // No "Based on" line: the reason is for developers (the console above), not for a visitor.
        return { ...plainReply(still.text, why), emotion: 'curious', sources: [], suggestions: [...still.chips] };
      }
      return plainReply(message, why);
    };
    let res: Response;
    try {
      res = await fetchImpl(`${o.url}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(toChatRequest(text, ctx, { sessionId, userId: o.userId, voice })),
        // Long enough for the slower Qwen engine (about 12 s typical), short enough not to stall the stage.
        ...(typeof AbortSignal.timeout === 'function' ? { signal: AbortSignal.timeout(o.timeoutMs ?? 25_000) } : {}),
      });
    } catch {
      return fallback(`backend not reachable at ${o.url}`, COPY[lang].unreachable);
    }
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const changed = () => turn !== generation || Boolean(ctx?.screen_revision && icarus.getContext?.().screen_revision !== ctx.screen_revision);
    if (changed()) return plainReply(lang === 'th' ? 'หน้าจอเปลี่ยนแล้ว โปรดถามอีกครั้ง' : 'The screen changed. Ask again using the current view.', 'Screen changed');
    if (!res.ok || !body || typeof body.text !== 'string') {
      // The backend's errors carry a message for the user in English and Thai.
      const detail = (body?.detail ?? null) as Record<string, unknown> | null;
      const message = detail && typeof detail[lang === 'th' ? 'message_th' : 'message_en'] === 'string' ? String(detail[lang === 'th' ? 'message_th' : 'message_en']) : COPY[lang].failed;
      return fallback(`backend error ${res.status}${detail?.code ? ` ${String(detail.code)}` : ''}`, message);
    }
    const { reply, trade, chart, steps } = toPrototypeReply(body as unknown as BackendReply, lang, ctx, proto);
    const later = (show: () => void) => window.setTimeout(() => { if (turn === generation) show(); }, o.cardDelayMs ?? 650);
    if (trade) later(() => o.showTrade(trade, lang));
    else if (chart && o.showChart) later(() => o.showChart?.(chart, lang));
    else if (steps && o.showSteps) later(() => o.showSteps?.(steps, lang));
    return reply;
  };

  icarus.setBackend(o.wrap ? o.wrap(ask) : ask);
  return true;
}
