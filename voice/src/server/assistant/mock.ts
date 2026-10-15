// MOCK assistant. Canned replies so the voice layer can be tested alone.
// Handles four things: explain, navigate, trade preview, refusal to give advice.
// It does NOT look at real data. The fee and total below are made up (1.5%).
// In the real assistant every number comes from a tool call (context.md rule 3).

import { MOCK_REPLIES } from '../../config/mock-replies';
import { STRINGS, fill } from '../../config/strings';
import { detectLang } from '../../shared/lang';
import { formatExactNumber } from '../../shared/speech-format';
import type { Assistant, AssistantReply, AssistantRequest, Lang } from '../../shared/types';
import type { UtopiaService } from '../utopia/service';

const ASSETS: Array<{ id: string; words: RegExp }> = [
  { id: 'gold', words: /gold|ทอง/i },
  { id: 'bitcoin', words: /bitcoin|btc|บิตคอยน์/i },
  { id: 'ethereum', words: /ethereum|\beth\b|อีเธอเรียม/i },
  { id: 'usdt', words: /usdt|tether/i },
];

const REFUSAL = /what should i (buy|invest)|should i (buy|invest|sell)|which (one )?(is better|should)|recommend|best (coin|asset|investment)|ควรซื้อ|แนะนำ|อะไรดี/i;
const TRADE = /\b(put|buy|invest|purchase|deposit)\b|ซื้อ|ลงทุน|ฝาก/i;
const NAVIGATE = /\b(take me|go to|open|show me|navigate)\b|พาไป|ไปที่|เปิด/i;

let previewCounter = 0;

export class MockAssistant implements Assistant {
  constructor(
    private readonly delayMs = 120,
    private readonly utopia?: UtopiaService,
  ) {}

  async ask(req: AssistantRequest): Promise<AssistantReply> {
    // Pretend to think. Real assistants take much longer than this.
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));

    const lang: Lang = req.language === 'auto' ? detectLang(req.text) : req.language;
    const text = req.text;
    const replies = MOCK_REPLIES[lang];
    const asset = ASSETS.find((a) => a.words.test(text))?.id ?? 'gold';
    const assetName = STRINGS[lang].assetNames[asset] ?? asset;

    // Questions about U-topia, and things Icarus cannot do (travel, drawing...): answer or hand off to U-Bot.
    const routed = await this.utopia?.route(text, lang);
    if (routed?.kind === 'answer') {
      const label = routed.source === 'mock' ? 'mock:utopia_glossary (not verified by U-topia)' : 'u-bot:ask_utopia';
      return { text: routed.answer, speak: true, ui_actions: [], sources: [label] };
    }
    if (routed?.kind === 'handoff') {
      const h = routed.handoff;
      return {
        text: h.message,
        speak: true,
        ui_actions: [{ type: 'handoff', target: h.target, reason: h.reason, label: h.label, url: h.url, question: h.question }],
        sources: ['handoff:u-bot'],
      };
    }

    if (REFUSAL.test(text)) {
      return { text: replies.refusal, speak: true, ui_actions: [], sources: ['mock:guardrail'] };
    }

    if (TRADE.test(text)) {
      const side = /deposit|ฝาก/i.test(text) ? 'deposit' : 'buy';
      const amount = parseAmount(text) ?? 1000;
      const fee = Math.round(amount * 0.015 * 100) / 100;
      const total = Math.round((amount + fee) * 100) / 100;
      return {
        text: fill(replies.previewText, { amount: formatExactNumber(amount), asset: assetName }),
        speak: true,
        ui_actions: [
          {
            type: 'show_card',
            card_type: 'preview',
            data: {
              preview_id: `mock-preview-${++previewCounter}`,
              side,
              asset: assetName,
              amount,
              fee,
              total,
              currency: 'THB',
            },
          },
          { type: 'highlight', element_id: 'buy.confirm_button', message: 'Tap to confirm' },
        ],
        sources: ['mock:prepare_trade'],
      };
    }

    if (NAVIGATE.test(text)) {
      return {
        text: fill(replies.navigate, { asset: assetName }),
        speak: true,
        // `navigate` is not in the contract yet (see UiAction in shared/types.ts).
        ui_actions: [{ type: 'navigate', screen: `asset.${asset}` }],
        sources: ['mock:navigate'],
      };
    }

    if (/what|explain|mean|red|number|why|อะไร|ทำไม|หมายถึง|ตัวเลข/i.test(text)) {
      return {
        text: replies.explain,
        speak: true,
        ui_actions: [{ type: 'highlight', element_id: 'asset.change24h', message: "Today's change" }],
        sources: ['mock:get_prices'],
      };
    }

    return { text: replies.fallback, speak: true, ui_actions: [], sources: ['mock'] };
  }
}

/** First number in the text, like "1,000" or "2500.50". */
function parseAmount(text: string): number | null {
  const m = /(\d[\d,]*(?:\.\d+)?)/.exec(text);
  if (!m?.[1]) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}
