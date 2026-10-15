import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpAssistant, errorReply, normalizeReply, toBackendRequest, withReadbackFields } from '../src/server/assistant/http';
import { buildReadback, extractPreview } from '../src/shared/readback';
import type { AssistantRequest } from '../src/shared/types';

// What Luka and First's backend sends for "put 1,000 baht in gold" (backend/app/tools.py prepare_trade_tool).
const BUY_CARD = {
  type: 'card',
  card_type: 'trade_preview',
  data: {
    preview_id: 'pv_1a2b3c4d', asset_id: 'gold', asset_name: 'Tokenized gold (PAX Gold)', side: 'buy', amount_thb: 1000, price_thb: 3650.5,
    unit: 'baht-weight', freshness: 'live', fee_is_mock: true, fee_thb: 5, qty: 0.27256, you_pay_thb: 1000, expires_in_s: 120,
  },
};
const SELL_CARD = {
  type: 'card',
  card_type: 'trade_preview',
  data: { preview_id: 'pv_9', asset_id: 'gold', asset_name: 'Gold', side: 'sell', amount_thb: 1000, fee_thb: 5, qty: 0.27, you_get_thb: 995 },
};
const REQ: AssistantRequest = { text: 'Put 1,000 baht in gold', language: 'en', userId: 'demo-user', sessionId: 's-1' };

describe("speaking the backend's contract (backend/app/contracts.py)", () => {
  it('sends session, user, language and voice mode, the snapshot as it is, plus the older fields', () => {
    const snapshot = { screen: 'asset', asset: { id: 'XAU' }, period: '1M' };
    const body = toBackendRequest({ ...REQ, snapshot }, 'u_new');
    expect(body).toEqual({ session_id: 's-1', user_id: 'u_new', text: REQ.text, lang: 'en', input_mode: 'voice', snapshot, language: 'en', userId: 'demo-user' });
    expect(toBackendRequest({ ...REQ, language: 'auto' }).lang).toBeNull(); // the backend detects it
    expect(toBackendRequest({ ...REQ, sessionId: undefined }).session_id).toBe('voice');
    expect(toBackendRequest(REQ)).not.toHaveProperty('snapshot');
  });

  it("passes the app's own screen actions through untouched", () => {
    const actions = [{ type: 'open_asset', asset: 'XAU' }, { type: 'type_amount', value: 1000 }, { type: 'review' }, { type: 'highlight', target: 'buy.fee_line' }];
    expect(normalizeReply({ text: 'ok', ui_actions: actions }).ui_actions).toEqual(actions);
  });
});

describe('an older backend\'s trade card: the read-back must say what it will charge', () => {
  it('buy: the fee is INCLUDED in what the user pays, so 995 goes into gold, total 1,000', () => {
    const reply = normalizeReply({ text: "Here's your preview.", speak: true, ui_actions: [BUY_CARD], sources: [] });
    expect(reply.ui_actions[0]).toMatchObject({ type: 'show_card', card_type: 'trade_preview' });
    const preview = extractPreview(reply);
    expect(preview).toEqual({ preview_id: 'pv_1a2b3c4d', side: 'buy', asset: 'gold', amount: 995, fee: 5, total: 1000, currency: 'THB' });
    expect(buildReadback(preview!, 'en')).toBe('nine hundred ninety-five baht into gold. Fee five baht. Total one thousand baht. Say confirm or cancel.');
    expect(buildReadback(preview!, 'th')).toBe('ซื้อทอง 995 บาท. ค่าธรรมเนียม 5 บาท. รวมทั้งหมด 1,000 บาท. พูดว่า ยืนยัน หรือ ยกเลิก.');
  });

  it('sell: the total is what the user gets', () => {
    const preview = extractPreview(normalizeReply({ text: 'ok', ui_actions: [SELL_CARD] }));
    expect(preview).toMatchObject({ side: 'sell', amount: 1000, fee: 5, total: 995 });
    expect(buildReadback(preview!, 'en')).toBe('Selling one thousand baht of gold. Fee five baht. You get nine hundred ninety-five baht. Say confirm or cancel.');
  });

  it('fails closed: a card missing a number gets no read-back (the user taps the card instead)', () => {
    const noFee = { ...BUY_CARD, data: { ...BUY_CARD.data, fee_thb: undefined } };
    expect(extractPreview(normalizeReply({ text: 'ok', ui_actions: [noFee] }))).toBeNull();
    const noPay = { ...BUY_CARD, data: { ...BUY_CARD.data, you_pay_thb: undefined } };
    expect(extractPreview(normalizeReply({ text: 'ok', ui_actions: [noPay] }))).toBeNull();
    expect(withReadbackFields({ side: 'buy', fee_thb: 50, you_pay_thb: 20 })).not.toHaveProperty('amount'); // fee bigger than the payment
  });

  it('leaves a card that already has amount and total alone (the older contract)', () => {
    const old = { preview_id: 'p', side: 'buy', asset: 'gold', amount: 1000, fee: 15, total: 1015, currency: 'THB' };
    expect(withReadbackFields(old)).toBe(old);
  });

  it('passes highlights through and keeps money to two decimals', () => {
    const reply = normalizeReply({ text: 'x', ui_actions: [{ type: 'highlight', element_id: 'asset.chart', message: 'The chart' }] });
    expect(reply.ui_actions).toEqual([{ type: 'highlight', element_id: 'asset.chart', message: 'The chart' }]);
    expect(withReadbackFields({ side: 'buy', fee_thb: 5.03, you_pay_thb: 1000.1 }).amount).toBe(995.07);
  });
});

describe('backend errors', () => {
  const detail = (code: string) => ({ detail: { code, message_en: 'Icarus is busy. Try again in a minute.', message_th: 'Icarus ยุ่งอยู่ ลองใหม่อีกนาทีนะ' } });

  it("says the backend's own message, in the user's language", () => {
    expect(errorReply(429, detail('rate_limited'), REQ)?.text).toBe('Icarus is busy. Try again in a minute.');
    expect(errorReply(429, detail('rate_limited'), { ...REQ, language: 'auto', text: 'ทองคืออะไร' })?.text).toBe('Icarus ยุ่งอยู่ ลองใหม่อีกนาทีนะ');
  });

  it('throws for a setup mistake (unknown user) and for a rejected request', () => {
    expect(errorReply(404, detail('unknown_user'), REQ)).toBeNull();
    expect(errorReply(422, { detail: [{ msg: 'bad' }] }, REQ)).toBeNull();
    expect(errorReply(500, 'Internal Server Error', REQ)).toBeNull();
  });
});

describe('HttpAssistant against a stand-in for the backend', () => {
  let server: Server;
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  /** Accepts only what backend/app/contracts.py ChatRequest accepts. */
  function standIn(): Promise<string> {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const b = JSON.parse(raw);
        const ok = typeof b.session_id === 'string' && typeof b.user_id === 'string' && typeof b.text === 'string' &&
          [null, 'en', 'th'].includes(b.lang) && ['text', 'voice'].includes(b.input_mode) &&
          (b.snapshot === undefined || (typeof b.snapshot === 'object' && b.snapshot !== null));
        if (!ok) {
          res.writeHead(422, { 'content-type': 'application/json' }).end(JSON.stringify({ detail: [{ msg: 'invalid' }] }));
          return;
        }
        if (b.user_id !== 'u_new') {
          res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ detail: { code: 'unknown_user', message_en: "We don't know that user.", message_th: 'ไม่พบผู้ใช้นี้' } }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
          text: "Here's your preview. You pay 1,000 baht and the fee is 5 baht.", speak: b.input_mode === 'voice', ui_actions: [BUY_CARD],
          sources: [{ result_id: 'r_1', tool: 'prepare_trade', provider: 'demo account (simulated)', as_of: null, freshness: 'live' }], debug: { model_calls: 2 },
        }));
      });
    });
    return new Promise((r) => server.listen(0, () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}/chat`)));
  }

  it('gets a reply the voice layer can read back and speak', async () => {
    const url = await standIn();
    const reply = await new HttpAssistant(url, 5000, 'u_new').ask({ ...REQ, snapshot: { screen: 'asset', period: 'ALL' } });
    expect(reply.speak).toBe(true);
    expect(extractPreview(reply)).toMatchObject({ amount: 995, fee: 5, total: 1000, currency: 'THB' });
    expect(reply.sources).toHaveLength(1);
  });

  it('tells you to set ASSISTANT_USER_ID when the backend does not know the user', async () => {
    const url = await standIn();
    await expect(new HttpAssistant(url, 5000).ask(REQ)).rejects.toThrow('HTTP 404 (unknown_user)');
  });
});
