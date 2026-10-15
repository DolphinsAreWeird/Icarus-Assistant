// Money read-back. Builds the sentence Icarus says before a trade or deposit can be confirmed.
//
// RULES (context.md section 5):
//   - Numbers come from the preview data, never from the assistant's sentence.
//   - Every number is exact. No rounding, no "about".
//   - If the preview is missing a field we need, we do NOT read anything back and we do NOT
//     offer a voice confirm. The user is sent to the card on screen instead.
//
// Example (English):  "one thousand baht into gold. Fee fifteen baht. Total one thousand fifteen baht.
//                      Say confirm or cancel."
//
// English amounts are spoken as WORDS on purpose. Tested on the live ElevenLabs voice, "1,015" was
// spoken as "1,215" (and "1015" as "10.15"), while "one thousand fifteen" was right every time.
// The card on screen keeps digits. Thai amounts stay as digits (the Thai model read them correctly).

import { STRINGS, fill } from '../config/strings';
import { spokenExactNumber } from './speech-format';
import type { AssistantReply, Lang, TradePreview } from './types';

/** card_type values we treat as a money preview. ASSUMPTION: agree these with Luka, First and Oasis. */
const PREVIEW_CARD_TYPES = new Set(['preview', 'trade_preview', 'deposit_preview', 'order_preview']);

/** The first show_card action that is a money preview, or null. */
export function findPreviewCard(reply: AssistantReply): Record<string, unknown> | null {
  for (const action of reply.ui_actions ?? []) {
    if (action.type === 'show_card' && PREVIEW_CARD_TYPES.has(action.card_type.toLowerCase())) {
      return action.data ?? {};
    }
  }
  return null;
}

function pickString(data: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** Accept a number or a plain numeric string like "1,015.50". Anything else is rejected. */
function pickAmount(data: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
    if (typeof value === 'string' && /^\d[\d,]*(\.\d+)?$/.test(value.trim())) {
      return Number(value.trim().replace(/,/g, ''));
    }
  }
  return null;
}

/**
 * Read the preview fields. Returns null (fail closed) unless we have all of:
 * id, side, asset, amount, fee, total and currency.
 */
export function parsePreview(data: Record<string, unknown>): TradePreview | null {
  const id = pickString(data, ['preview_id', 'previewId', 'id']);
  const sideRaw = pickString(data, ['side', 'action', 'type'])?.toLowerCase();
  // spoken_asset: a short name made for speech (the backend adapter sets it to the asset id, e.g. "gold").
  const asset = pickString(data, ['spoken_asset', 'asset_name', 'asset_label', 'asset', 'asset_id', 'symbol']);
  const amount = pickAmount(data, ['amount', 'amount_in']);
  const fee = pickAmount(data, ['fee', 'fees', 'fee_amount']);
  const total = pickAmount(data, ['total', 'total_amount']);
  const currency = pickString(data, ['currency', 'quote_currency', 'fiat_currency']);

  const side = sideRaw === 'buy' || sideRaw === 'sell' || sideRaw === 'deposit' ? sideRaw : null;
  if (!id || !side || !asset || amount === null || fee === null || total === null || !currency) {
    return null;
  }
  return { preview_id: id, side, asset, amount, fee, total, currency };
}

/** Convenience: find the card, then parse it. */
export function extractPreview(reply: AssistantReply): TradePreview | null {
  const card = findPreviewCard(reply);
  return card ? parsePreview(card) : null;
}

/**
 * The exact sentence for this preview, in this language. Ends with the "say confirm or cancel" prompt, unless
 * `prompt: false` (when confirming is by tap only).
 */
export function buildReadback(preview: TradePreview, lang: Lang, options: { prompt?: boolean } = {}): string {
  const s = STRINGS[lang];
  const plural = s.currencyWords[preview.currency.toUpperCase()] ?? preview.currency;
  // "one dollar", not "one dollars". Baht, yen and Thai words do not change.
  const currencyFor = (n: number) => (lang === 'en' && n === 1 && /(dollar|euro|pound)s$/.test(plural) ? plural.slice(0, -1) : plural);
  const asset = s.assetNames[preview.asset.toLowerCase()] ?? preview.asset;
  const amount = spokenExactNumber(preview.amount, lang);
  const sideTemplate = s.readback[preview.side];

  const parts = [
    fill(sideTemplate, { amount, currency: currencyFor(preview.amount), asset }),
    fill(s.readback.fee, { fee: spokenExactNumber(preview.fee, lang), currency: currencyFor(preview.fee) }),
    fill(preview.side === 'sell' ? s.readback.totalSell : s.readback.total, { total: spokenExactNumber(preview.total, lang), currency: currencyFor(preview.total) }),
  ];
  if (options.prompt !== false) parts.push(s.readback.prompt.endsWith('.') ? s.readback.prompt : `${s.readback.prompt}.`);
  return parts.join(' ');
}
