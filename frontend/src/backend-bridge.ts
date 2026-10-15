// Connects Oasis's prototype to Luka and First's backend (backend/, POST /chat), through the prototype's own hook
// Icarus.setBackend(fn). Opt in by opening the app with ?backend (http://localhost:8000) or ?backend=<url>,
// and ?user=u_small to switch the demo user (default u_new). Without it nothing changes: the demo answers run.
//
// The backend speaks the prototype's language (backend/app/ui.py, backend/data/app_ui.json):
//   - we send the prototype's own getContext() as `snapshot`; the backend reads the screen, asset and numbers from it
//   - it answers with the prototype's own screen actions (open_asset, start_buy, type_amount, review, highlight...),
//     already checked against the closed list, so they pass straight through to the prototype
//
// A buy stops on the prototype's review screen. The user taps Confirm purchase there (hard rule 4). For voice we
// read the purchase back EXACTLY, with the numbers the review screen will show: they come from the prototype's own
// calc(), the same function its screen uses, never from the model's words (hard rule 3).

import { withReadbackFields } from '../../voice/src/shared/backend-card';
import { buildReadback, parsePreview } from '../../voice/src/shared/readback';
import { STRINGS } from '../../voice/src/config/strings';

export const DEFAULT_BACKEND_URL = 'http://localhost:8000';
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

/**
 * The backend's reply as the prototype's. Screen actions pass through (the backend checked them). A buy gets the
 * exact read-back as its spoken line. An older backend's trade card is returned separately, for our own card.
 */
export function toPrototypeReply(r: BackendReply, lang: 'en' | 'th', ctx?: PrototypeContext, proto: PrototypeLike | null = null): { reply: PrototypeReply; trade: Record<string, unknown> | null } {
  const actions: Array<Record<string, unknown>> = [];
  let trade: Record<string, unknown> | null = null;
  for (const a of r.ui_actions ?? []) {
    if (!a || typeof a.type !== 'string') continue;
    if (a.type === 'card') {
      if (a.card_type === 'trade_preview' && a.data && typeof a.data === 'object') trade = withReadbackFields(a.data as Record<string, unknown>);
    } else if (a.type === 'highlight' && typeof a.element_id === 'string' && a.target === undefined) {
      actions.push({ type: 'highlight', target: a.element_id }); // the older backend's shape
    } else {
      actions.push(a);
    }
  }
  let speech = buyReadback(actions, ctx, proto, lang) ?? r.text;
  const preview = trade ? parsePreview(trade) : null;
  if (preview) speech = `${buildReadback(preview, lang, { prompt: false })} ${STRINGS[lang].lines.tapToConfirm}`;
  return {
    reply: {
      text: r.text,
      speech,
      emotion: trade || actions.some((a) => a.type === 'review') ? 'excited' : 'happy',
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
  getInstance: () => PrototypeLike | null;
  /** Put the U-topia routing around the backend (withUtopiaRouting). */
  wrap?: (fn: (q: string, ctx: unknown) => Promise<PrototypeReply>) => (q: string, ctx: unknown) => unknown;
  /** Only for an older backend that still sends trade cards. */
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
    const ctx = (rawCtx ?? undefined) as PrototypeContext | undefined;
    const lang = langOf(text, ctx);
    const proto = o.getInstance();
    const voice = proto?.state?.asst === 'voice';
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
    const { reply, trade } = toPrototypeReply(body as unknown as BackendReply, lang, ctx, proto);
    if (trade) window.setTimeout(() => o.showTrade(trade, lang), o.cardDelayMs ?? 650);
    return reply;
  };

  icarus.setBackend(o.wrap ? o.wrap(ask) : ask);
  return true;
}
