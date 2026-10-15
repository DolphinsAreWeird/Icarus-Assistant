// Adapter for the real assistant: Luka and First's backend (backend/, FastAPI, POST /chat).
//   ASSISTANT_MODE=http
//   ASSISTANT_URL=http://localhost:8000/chat
//   ASSISTANT_USER_ID=u_new            (the backend only knows its demo users: u_new, u_small)
//
// Their contract (backend/app/contracts.py):
//   request  { session_id, user_id, text, lang: 'en' | 'th' | null, input_mode: 'voice', screen_context? }
//   reply    { text, speak, ui_actions: [highlight | card], sources, debug }
// We also send the older context.md fields (language, snapshot, userId). The backend ignores extra fields.
//
// MONEY (see shared/backend-card.ts): the backend's trade card says what the user PAYS with the fee INCLUDED (you_pay_thb), or what they GET
// (you_get_thb). The read-back needs an amount, a fee and a total that add up, so withReadbackFields() adds them.
// If any number is missing, the card goes through untouched and the read-back fails closed (tap only).

import { withReadbackFields } from '../../shared/backend-card';
import { detectLang } from '../../shared/lang';
import type { Assistant, AssistantReply, AssistantRequest, Snapshot, UiAction } from '../../shared/types';

export class HttpAssistant implements Assistant {
  constructor(
    private readonly url: string,
    private readonly timeoutMs: number,
    private readonly userId?: string,
  ) {}

  async ask(req: AssistantRequest): Promise<AssistantReply> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toBackendRequest(req, this.userId)),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const spoken = errorReply(res.status, body, req);
      if (spoken) return spoken;
      throw new Error(`Assistant returned HTTP ${res.status}${errorCode(body) ? ` (${errorCode(body)})` : ''}`);
    }
    return normalizeReply(await res.json());
  }
}

const PERIODS = new Set(['1d', '1w', '1m', '1y']);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** The request in the backend's shape, plus the older fields. */
export function toBackendRequest(req: AssistantRequest, userId?: string): Record<string, unknown> {
  const screen = toScreenContext(req.snapshot);
  return {
    session_id: req.sessionId ?? 'voice',
    user_id: userId ?? req.userId,
    text: req.text,
    lang: req.language === 'auto' ? null : req.language,
    input_mode: 'voice',
    ...(screen ? { screen_context: screen } : {}),
    language: req.language,
    userId: req.userId,
    ...(req.snapshot ? { snapshot: req.snapshot } : {}),
  };
}

/**
 * The backend validates screen_context strictly (an unknown chart period fails the whole request), so only
 * values it accepts are sent. No screen name, no screen_context.
 */
export function toScreenContext(snapshot?: Snapshot): Record<string, unknown> | undefined {
  if (!snapshot) return undefined;
  const s = snapshot as Record<string, unknown>;
  const screen = str(s.screen_id) ?? str(s.screen);
  if (!screen) return undefined;
  const asset = str(s.selected_asset) ?? str(s.asset) ?? str((s.asset as Record<string, unknown> | undefined)?.id);
  const period = (str(s.chart_period) ?? str(s.period))?.toLowerCase();
  const amount = s.entered_amount;
  return {
    screen_id: screen,
    selected_asset: asset?.toLowerCase() ?? null,
    chart_period: period && PERIODS.has(period) ? period : null,
    visible_elements: Array.isArray(s.visible_elements) ? s.visible_elements.filter((x) => typeof x === 'string') : [],
    focused_element: str(s.focused_element) ?? str(s.focus) ?? null,
    entered_amount: typeof amount === 'number' && Number.isFinite(amount) ? amount : null,
  };
}

/** Make sure whatever came back has the four fields the voice layer needs, in our action shapes. */
export function normalizeReply(raw: unknown): AssistantReply {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (typeof r.text !== 'string') throw new Error('Assistant reply has no text');
  return {
    text: r.text,
    ...(typeof r.speech === 'string' && r.speech.trim() ? { speech: r.speech } : {}),
    ...(typeof r.emotion === 'string' ? { emotion: r.emotion } : {}),
    speak: typeof r.speak === 'boolean' ? r.speak : true,
    ui_actions: Array.isArray(r.ui_actions) ? r.ui_actions.filter(isObject).map(toUiAction) : [],
    sources: Array.isArray(r.sources) ? (r.sources as AssistantReply['sources']) : [],
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The backend says `card` + card_type + data. We say `show_card`. Everything else passes through. */
function toUiAction(a: Record<string, unknown>): UiAction {
  if (a.type !== 'card') return a as UiAction;
  const cardType = str(a.card_type) ?? 'card';
  const data = isObject(a.data) ? a.data : {};
  return { type: 'show_card', card_type: cardType, data: cardType === 'trade_preview' ? withReadbackFields(data) : data };
}

function errorCode(body: unknown): string | undefined {
  const detail = isObject(body) && isObject(body.detail) ? body.detail : undefined;
  return str(detail?.code);
}

/**
 * The backend's errors carry a message for the user in English and Thai (busy, not set up, preview expired...).
 * Say it, instead of a generic failure. Not for unknown_user: that is a setup mistake (ASSISTANT_USER_ID), so it throws.
 */
export function errorReply(status: number, body: unknown, req: AssistantRequest): AssistantReply | null {
  const detail = isObject(body) && isObject(body.detail) ? body.detail : undefined;
  if (!detail || status === 422 || detail.code === 'unknown_user') return null;
  const lang = req.language === 'auto' ? detectLang(req.text) : req.language;
  const message = str(lang === 'th' ? detail.message_th : detail.message_en) ?? str(detail.message_en);
  if (!message) return null;
  return { text: message, speak: true, ui_actions: [], sources: [] };
}

export { withReadbackFields };
