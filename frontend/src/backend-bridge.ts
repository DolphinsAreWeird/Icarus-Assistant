// Connects Oasis's prototype to Luka and First's backend (backend/, POST /chat), through the prototype's own hook
// Icarus.setBackend(fn). Opt in by opening the app with ?backend (http://localhost:8000) or ?backend=<url>,
// and ?user=u_small to switch the demo user (default u_new). Without it nothing changes: the demo answers run.
//
// What comes from the backend: Icarus's answers (live prices, the demo account, the guardrails) and trade previews.
// The prototype's SCREENS still show its own demo data (John Doe, prices in dollars). Connecting those is the
// next step for the team (see INTEGRATION.md).
//
// A trade preview goes on our own card (trade-card.ts) with the backend's numbers, and Icarus reads it back from
// that card, exactly. We do NOT drive the prototype's buy screen: it adds its own fee (1.5% on top), which would
// show different numbers from the backend's (0.25%, at least 5 baht, included). One fee rule must be agreed.
// Confirming is a tap on the card, never a voice command (hard rule 4).

import { withReadbackFields } from '../../voice/src/shared/backend-card';
import { buildReadback, parsePreview } from '../../voice/src/shared/readback';
import { STRINGS } from '../../voice/src/config/strings';

export const DEFAULT_BACKEND_URL = 'http://localhost:8000';
export const DEFAULT_USER = 'u_new';

/** Prototype screen names to the backend's screen ids (backend/data/ui_elements.json). */
export const SCREEN_IDS: Record<string, string> = {
  home: 'home',
  wallets: 'wallets',
  payments: 'payments',
  card: 'card',
  invest: 'portfolio',
  portfolio: 'portfolio',
  asset: 'asset_detail',
  buy: 'buy',
};

/** Prototype asset ids to the backend's. AAPL and TSLA are not in the backend; USDT is not in the prototype. */
export const ASSET_IDS: Record<string, string> = { BTC: 'btc', ETH: 'eth', XAU: 'gold', USDT: 'usdt' };

const PERIODS: Record<string, string> = { '1D': '1d', '1W': '1w', '1M': '1m', '1Y': '1y' };
const THAI = /[฀-๿]/;

/** What the prototype's getContext() returns (only the parts we use). */
export interface PrototypeContext {
  screen?: string;
  language?: string;
  asset?: { id?: string };
  period?: string;
  buy?: { amount_thb?: number } | null;
  focus?: string;
}

export interface BackendReply {
  text: string;
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

/** The prototype's context as the backend's ChatRequest (backend/app/contracts.py). */
export function toChatRequest(text: string, ctx: PrototypeContext | undefined, o: { sessionId: string; userId: string; voice: boolean }) {
  const screen = ctx?.screen ? SCREEN_IDS[ctx.screen] ?? ctx.screen : undefined;
  const amount = ctx?.buy?.amount_thb;
  return {
    session_id: o.sessionId,
    user_id: o.userId,
    text,
    lang: langOf(text, ctx),
    input_mode: o.voice ? 'voice' : 'text',
    ...(screen
      ? {
          screen_context: {
            screen_id: screen,
            selected_asset: (ctx?.asset?.id && ASSET_IDS[ctx.asset.id]) || null,
            chart_period: (ctx?.period && PERIODS[ctx.period]) || null,
            visible_elements: [],
            focused_element: ctx?.focus ?? null,
            entered_amount: typeof amount === 'number' && amount > 0 ? amount : null,
          },
        }
      : {}),
  };
}

/** "get_prices · binance + frankfurter (live)", once each. */
function sourceLabels(sources: Array<Record<string, unknown>> = []): string[] {
  const labels = sources.map((s) => `${String(s.tool ?? 'data')} · ${String(s.provider ?? '')}${s.freshness && s.freshness !== 'n/a' ? ` (${String(s.freshness)})` : ''}`);
  return [...new Set(labels)];
}

/**
 * The backend's reply as the prototype's. Highlights become the prototype's highlight action. A trade preview
 * is returned separately (for our card), and the spoken line becomes the exact read-back of that card.
 */
export function toPrototypeReply(r: BackendReply, lang: 'en' | 'th'): { reply: PrototypeReply; trade: Record<string, unknown> | null } {
  const actions: Array<Record<string, unknown>> = [];
  let trade: Record<string, unknown> | null = null;
  for (const a of r.ui_actions ?? []) {
    if (a.type === 'highlight' && typeof a.element_id === 'string') actions.push({ type: 'highlight', target: a.element_id });
    else if (a.type === 'card' && a.card_type === 'trade_preview' && a.data && typeof a.data === 'object') trade = withReadbackFields(a.data as Record<string, unknown>);
  }
  let speech = r.text;
  const preview = trade ? parsePreview(trade) : null;
  if (preview) speech = `${buildReadback(preview, lang, { prompt: false })} ${STRINGS[lang].lines.tapToConfirm}`;
  return {
    reply: {
      text: r.text,
      speech,
      emotion: trade ? 'excited' : 'happy',
      speak: r.speak ?? true,
      ui_actions: actions,
      sources: sourceLabels(r.sources),
      suggestions: [],
      offer: null,
    },
    trade,
  };
}

const COPY = {
  en: { unreachable: "I can't reach the Icarus brain right now. Is the backend running?", failed: "I couldn't answer just now. Try again." },
  th: { unreachable: 'ตอนนี้ติดต่อสมองของ Icarus ไม่ได้ เปิด backend อยู่หรือเปล่า', failed: 'ตอนนี้ตอบไม่ได้ ลองอีกครั้งนะ' },
} as const;

function plainReply(text: string, source: string): PrototypeReply {
  return { text, speech: text, emotion: 'thinking', speak: true, ui_actions: [], sources: [source], suggestions: [], offer: null };
}

export interface BackendBridgeOptions {
  url: string;
  userId: string;
  getInstance: () => { state?: { asst?: string } } | null;
  /** Put the U-topia routing around the backend (withUtopiaRouting). */
  wrap?: (fn: (q: string, ctx: unknown) => Promise<PrototypeReply>) => (q: string, ctx: unknown) => unknown;
  showTrade: (card: Record<string, unknown>, lang: 'en' | 'th') => void;
  hideTrade: () => void;
  fetchImpl?: typeof fetch;
  /** The card appears after the reply bubble. */
  cardDelayMs?: number;
}

/** Hand the prototype's questions to the backend. Returns false if the prototype has not mounted yet. */
export function installBackend(o: BackendBridgeOptions): boolean {
  const icarus = (window as unknown as { Icarus?: { setBackend?: (fn: unknown) => void } }).Icarus;
  if (!icarus?.setBackend) return false;
  const fetchImpl = o.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const sessionId = `app-${Date.now().toString(36)}`;

  const ask = async (text: string, rawCtx: unknown): Promise<PrototypeReply> => {
    o.hideTrade();
    const ctx = (rawCtx ?? {}) as PrototypeContext;
    const lang = langOf(text, ctx);
    const voice = o.getInstance()?.state?.asst === 'voice';
    let res: Response;
    try {
      res = await fetchImpl(`${o.url}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(toChatRequest(text, ctx, { sessionId, userId: o.userId, voice })),
      });
    } catch {
      return plainReply(COPY[lang].unreachable, `Backend not reachable at ${o.url}`);
    }
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !body || typeof body.text !== 'string') {
      // The backend's errors carry a message for the user in English and Thai.
      const detail = (body?.detail ?? null) as Record<string, unknown> | null;
      const message = detail && typeof detail[lang === 'th' ? 'message_th' : 'message_en'] === 'string' ? String(detail[lang === 'th' ? 'message_th' : 'message_en']) : COPY[lang].failed;
      return plainReply(message, `Backend error ${res.status}${detail?.code ? ` (${String(detail.code)})` : ''}`);
    }
    const { reply, trade } = toPrototypeReply(body as unknown as BackendReply, lang);
    if (trade) window.setTimeout(() => o.showTrade(trade, lang), o.cardDelayMs ?? 650);
    return reply;
  };

  icarus.setBackend(o.wrap ? o.wrap(ask) : ask);
  return true;
}
