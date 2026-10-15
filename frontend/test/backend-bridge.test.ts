// The prototype talking to Luka and First's backend (POST /chat), and the trade card's confirm-by-tap.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backendFromLocation, installBackend, toChatRequest, toPrototypeReply, type PrototypeReply } from '../src/backend-bridge';
import { hideTradeCard, showTradeCard } from '../src/trade-card';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// What the backend's prepare_trade puts in a reply (backend/app/tools.py).
const TRADE = {
  type: 'card',
  card_type: 'trade_preview',
  data: {
    preview_id: 'pv_abc', asset_id: 'gold', asset_name: 'Tokenized gold (PAX Gold)', side: 'buy', amount_thb: 1000,
    price_thb: 139137.82, unit: 'PAXG', freshness: 'live', fee_is_mock: true, fee_thb: 5, qty: 0.00715118, you_pay_thb: 1000, expires_in_s: 120,
  },
};
const REPLY = {
  text: "Here's your preview. You pay 1,000 baht and the fee is 5 baht.",
  speak: true,
  ui_actions: [{ type: 'highlight', element_id: 'buy.fee_line', message: 'The fee' }, TRADE],
  sources: [
    { result_id: 'r1', tool: 'prepare_trade', provider: 'demo account (simulated)', freshness: 'live' },
    { result_id: 'r2', tool: 'prepare_trade', provider: 'demo account (simulated)', freshness: 'live' },
  ],
};

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status < 400, status, json: async () => body } as Response;
}

afterEach(() => {
  hideTradeCard();
  delete (window as unknown as { Icarus?: unknown }).Icarus;
});

describe('switching the backend on', () => {
  it('reads ?backend, ?backend=<url> and ?user from the address', () => {
    expect(backendFromLocation('')).toBeNull();
    expect(backendFromLocation('?backend')).toEqual({ url: 'http://localhost:8000', userId: 'u_new' });
    expect(backendFromLocation('?backend=http://127.0.0.1:8010/&user=u_small')).toEqual({ url: 'http://127.0.0.1:8010', userId: 'u_small' });
  });

  it('refuses anything that is not an http address, and odd user ids', () => {
    expect(backendFromLocation('?backend=javascript:alert(1)')).toBeNull();
    expect(backendFromLocation('?backend=not a url')).toBeNull();
    expect(backendFromLocation('?backend&user=<script>')?.userId).toBe('u_new');
  });
});

describe("the prototype's context as the backend's request", () => {
  it('maps screen, asset, period, focus and the typed amount', () => {
    const body = toChatRequest('What is this?', { screen: 'buy', language: 'en', asset: { id: 'XAU' }, period: '1M', focus: 'buy.fee_line', buy: { amount_thb: 1000 } }, { sessionId: 's', userId: 'u_new', voice: true });
    expect(body).toEqual({
      session_id: 's', user_id: 'u_new', text: 'What is this?', lang: 'en', input_mode: 'voice',
      screen_context: { screen_id: 'buy', selected_asset: 'gold', chart_period: '1m', visible_elements: [], focused_element: 'buy.fee_line', entered_amount: 1000 },
    });
  });

  it('sends only values the backend accepts', () => {
    const body = toChatRequest('ทองคืออะไร', { screen: 'asset', asset: { id: 'AAPL' }, period: '3M' }, { sessionId: 's', userId: 'u', voice: false }) as { lang: string; input_mode: string; screen_context: Record<string, unknown> };
    expect(body.lang).toBe('th');
    expect(body.input_mode).toBe('text');
    expect(body.screen_context).toMatchObject({ screen_id: 'asset_detail', selected_asset: null, chart_period: null });
    expect(toChatRequest('hi', undefined, { sessionId: 's', userId: 'u', voice: false })).not.toHaveProperty('screen_context');
  });
});

describe("the backend's reply as the prototype's", () => {
  it('turns highlights into the prototype action and reads the trade card back exactly', () => {
    const { reply, trade } = toPrototypeReply(REPLY, 'en');
    expect(reply.ui_actions).toEqual([{ type: 'highlight', target: 'buy.fee_line' }]);
    expect(trade).toMatchObject({ preview_id: 'pv_abc', amount: 995, fee: 5, total: 1000, currency: 'THB' });
    expect(reply.text).toBe(REPLY.text);
    expect(reply.speech).toBe('nine hundred ninety-five baht into gold. Fee five baht. Total one thousand baht. Tap Confirm on the card when you are ready.');
    expect(reply.sources).toEqual(['prepare_trade · demo account (simulated) (live)']);
  });

  it('in Thai, the read-back keeps digits', () => {
    expect(toPrototypeReply(REPLY, 'th').reply.speech).toBe('ซื้อทอง 995 บาท. ค่าธรรมเนียม 5 บาท. รวมทั้งหมด 1,000 บาท. พร้อมเมื่อไหร่ แตะยืนยันบนการ์ดได้เลย');
  });

  it('speaks the plain text when there is no card, or when the card is missing a number', () => {
    expect(toPrototypeReply({ text: 'Gold is a metal.' }, 'en').reply.speech).toBe('Gold is a metal.');
    const broken = { ...REPLY, ui_actions: [{ ...TRADE, data: { ...TRADE.data, fee_thb: undefined } }] };
    expect(toPrototypeReply(broken, 'en').reply.speech).toBe(REPLY.text);
  });
});

describe('installBackend', () => {
  function install(fetchImpl: typeof fetch, showTrade = vi.fn()) {
    let backend: ((q: string, ctx: unknown) => Promise<PrototypeReply>) | null = null;
    (window as unknown as { Icarus: unknown }).Icarus = { setBackend: (fn: typeof backend) => (backend = fn) };
    const ok = installBackend({ url: 'http://be', userId: 'u_new', getInstance: () => ({ state: { asst: 'voice' } }), showTrade, hideTrade: () => undefined, fetchImpl, cardDelayMs: 0 });
    expect(ok).toBe(true);
    return { ask: (q: string, ctx: unknown = { screen: 'asset', asset: { id: 'XAU' }, language: 'en' }) => backend!(q, ctx), showTrade };
  }

  it('asks /chat in voice mode and shows the card after the reply', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, REPLY)) as unknown as typeof fetch;
    const { ask, showTrade } = install(fetchImpl);
    const reply = await ask('Put 1,000 baht in gold');
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls[0]!;
    expect(url).toBe('http://be/chat');
    expect(JSON.parse(init.body)).toMatchObject({ user_id: 'u_new', input_mode: 'voice', screen_context: { selected_asset: 'gold' } });
    expect(reply.speech).toContain('Total one thousand baht');
    await sleep(5);
    expect(showTrade).toHaveBeenCalledWith(expect.objectContaining({ preview_id: 'pv_abc', total: 1000 }), 'en');
  });

  it("says the backend's own error message, or that the backend is not reachable", async () => {
    const busy = install(vi.fn(async () => jsonResponse(429, { detail: { code: 'rate_limited', message_en: 'Icarus is busy. Try again in a minute.', message_th: 'Icarus ยุ่งอยู่' } })) as unknown as typeof fetch);
    expect((await busy.ask('hello')).text).toBe('Icarus is busy. Try again in a minute.');
    const down = install(vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch);
    const reply = await down.ask('hello');
    expect(reply.text).toContain("can't reach the Icarus brain");
    expect(reply.sources[0]).toContain('not reachable');
  });
});

describe('the trade card', () => {
  const card = { ...TRADE.data, amount: 995, fee: 5, total: 1000, currency: 'THB' };

  it("shows the backend's numbers and confirms only on a tap", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { status: 'confirmed', transaction: { id: 'tx_1', qty: 0.00715118 }, cash_thb: 3000 })) as unknown as typeof fetch;
    const onConfirmed = vi.fn();
    const el = showTradeCard(card, { lang: 'en', backendUrl: 'http://be', userId: 'u_new', getPhone: () => null, fetchImpl, onConfirmed });
    expect(el.textContent).toContain('995.00 THB');
    expect(el.textContent).toContain('5.00 THB (demo fee)');
    expect(el.textContent).toContain('1,000.00 THB');
    expect(el.textContent).toContain('Price held for 2:00');
    expect(fetchImpl).not.toHaveBeenCalled();

    (el.querySelector('button') as HTMLButtonElement).click();
    await sleep(5);
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls[0]!;
    expect(url).toBe('http://be/trades/pv_abc/confirm');
    expect(JSON.parse(init.body)).toEqual({ user_id: 'u_new' });
    expect(el.textContent).toContain('Done. Cash left: 3,000.00 THB.');
    expect(onConfirmed).toHaveBeenCalledWith(expect.anything(), 'Done. You bought 0.00715118 PAXG of gold for 1,000.00 THB. Cash left: 3,000.00 THB.');
  });

  it("shows the backend's reason when it refuses (an expired price), and lets the user close the card", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(409, { detail: { code: 'preview_expired', message_en: 'That preview expired. Ask again for a fresh price.', message_th: 'รายการนี้หมดเวลาแล้ว' } })) as unknown as typeof fetch;
    const el = showTradeCard(card, { lang: 'en', backendUrl: 'http://be', userId: 'u_new', getPhone: () => null, fetchImpl });
    const [confirm, cancel] = Array.from(el.querySelectorAll('button')) as HTMLButtonElement[];
    confirm!.click();
    await sleep(5);
    expect(el.textContent).toContain('That preview expired. Ask again for a fresh price.');
    expect(cancel!.disabled).toBe(false);
    cancel!.click();
    expect(document.getElementById('icarus-trade')).toBeNull();
  });

  it('stops offering Confirm when the held price runs out', () => {
    vi.useFakeTimers();
    try {
      const el = showTradeCard({ ...card, expires_in_s: 2 }, { lang: 'th', backendUrl: 'http://be', userId: 'u_new', getPhone: () => null });
      expect(el.textContent).toContain('ล็อกราคาไว้ 0:02');
      vi.advanceTimersByTime(3000);
      expect((el.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
      expect(el.textContent).toContain('ราคานี้หมดเวลาแล้ว');
    } finally {
      vi.useRealTimers();
    }
  });
});
