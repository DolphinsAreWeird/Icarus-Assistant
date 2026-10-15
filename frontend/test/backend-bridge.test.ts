// The prototype talking to Luka and First's backend (POST /chat), with the backend's own screen actions,
// the exact buy read-back from the prototype's calculator, and the older trade card's confirm-by-tap.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setMascotFallback } from '../src/assets';
import { backendFromLocation, buyReadback, installBackend, SCREEN_ACTIONS, toChatRequest, toPrototypeAction, toPrototypeReply, type PrototypeLike, type PrototypeReply } from '../src/backend-bridge';
import { axisLabel, chartSvg, hideInfoCard, showStepsCard } from '../src/chat-cards';
import { createDcApp, installHelmet } from '../src/dc-runtime';
import { hideTradeCard, showTradeCard } from '../src/trade-card';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const HTML = readFileSync(path.join(__dirname, '../prototype/Icarus Prototype.dc.html'), 'utf8');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// What the backend sends for "put 1,000 baht in gold" from the Home screen (backend/app/ui.py prepare_buy).
const BUY_ACTIONS = [
  { type: 'open_asset', asset: 'XAU' },
  { type: 'start_buy', asset: 'XAU' },
  { type: 'type_amount', value: 1000 },
  { type: 'select_wallet', wallet: 'thb' },
  { type: 'review' },
];
const BUY_REPLY = {
  text: "I've set up 1,000 baht of gold. Check the fee and total, then tap Confirm purchase.",
  speak: true,
  ui_actions: BUY_ACTIONS,
  sources: [
    { result_id: 'r1', tool: 'get_prices', provider: 'binance + frankfurter', freshness: 'live' },
    { result_id: 'r2', tool: 'get_prices', provider: 'binance + frankfurter', freshness: 'live' },
  ],
};
// A stand-in for the prototype's calc(): 1% fee on top, like the real one (FEE=0.01).
const fakeProto = (ok = true): PrototypeLike => ({ calc: (_a, amt) => ({ amt, fee: Math.round(amt * 0.01 * 100) / 100, total: amt + Math.round(amt * 0.01 * 100) / 100, ok }) });

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

describe('the request: the prototype context goes as the snapshot, untouched', () => {
  it('sends session, user, language, voice mode and the snapshot', () => {
    const ctx = { screen: 'asset', language: 'en', asset: { id: 'XAU', name: 'Gold' }, period: '1M', focus: 'asset.chart' };
    expect(toChatRequest('What is this?', ctx, { sessionId: 's', userId: 'u_new', voice: true })).toEqual({
      session_id: 's', user_id: 'u_new', text: 'What is this?', lang: 'en', input_mode: 'voice', snapshot: ctx,
    });
  });

  it('detects Thai from the words, and sends no snapshot when there is none', () => {
    expect(toChatRequest('ทองคืออะไร', { screen: 'home', language: 'en' }, { sessionId: 's', userId: 'u', voice: false })).toMatchObject({ lang: 'th', input_mode: 'text' });
    expect(toChatRequest('hi', undefined, { sessionId: 's', userId: 'u', voice: false })).not.toHaveProperty('snapshot');
  });
});

describe("the reply: the backend's screen actions, and the exact buy read-back", () => {
  it('passes the screen actions through and reads the buy back from the prototype calculator', () => {
    const { reply, trade } = toPrototypeReply(BUY_REPLY, 'en', { asset: { id: 'XAU' } }, fakeProto());
    expect(trade).toBeNull();
    expect(reply.ui_actions).toEqual(BUY_ACTIONS);
    expect(reply.text).toBe(BUY_REPLY.text);
    expect(reply.speech).toBe('one thousand baht into gold. Fee ten baht. Total one thousand ten baht. Tap Confirm purchase when you are ready.');
    expect(reply.sources).toEqual(['get_prices · binance + frankfurter (live)']);
  });

  it('in Thai, the read-back keeps digits', () => {
    expect(toPrototypeReply(BUY_REPLY, 'th', undefined, fakeProto()).reply.speech).toBe('ซื้อทอง 1,000 บาท. ค่าธรรมเนียม 10 บาท. รวมทั้งหมด 1,010 บาท. พร้อมเมื่อไหร่ แตะยืนยันการซื้อได้เลย');
  });

  it('says the plain text when it is not a full buy, or the prototype would refuse it', () => {
    expect(buyReadback([{ type: 'open_asset', asset: 'XAU' }], undefined, fakeProto(), 'en')).toBeNull();
    expect(buyReadback(BUY_ACTIONS, undefined, fakeProto(false), 'en')).toBeNull(); // not enough balance, below minimum
    expect(buyReadback(BUY_ACTIONS, undefined, null, 'en')).toBeNull();
    expect(toPrototypeReply({ text: 'Gold is a metal.' }, 'en').reply.speech).toBe('Gold is a metal.');
  });

  it("still understands the older backend's highlight and trade card", () => {
    const old = toPrototypeReply({ text: 't', ui_actions: [{ type: 'highlight', element_id: 'buy.fee_line', message: 'm' }, { type: 'card', card_type: 'trade_preview', data: { preview_id: 'pv', asset_id: 'gold', side: 'buy', fee_thb: 5, you_pay_thb: 1000 } }] }, 'en');
    expect(old.reply.ui_actions).toEqual([{ type: 'highlight', target: 'buy.fee_line' }]);
    expect(old.trade).toMatchObject({ amount: 995, fee: 5, total: 1000 });
    expect(old.reply.speech).toContain('Total one thousand baht. Tap Confirm on the card');
  });
});

// What the backend sends now (backend/app/tools.py, after First's 22:16 update).
const TRADE_CARD = {
  type: 'card', card_type: 'trade_preview',
  data: { preview_id: 'pv_abc', asset_id: 'gold', asset_name: 'Tokenized gold (PAX Gold)', side: 'buy', amount_thb: 1000, price_thb: 139137.82, unit: 'PAXG', freshness: 'live', fee_is_mock: true, fee_thb: 5, qty: 0.00715118, you_pay_thb: 1000, expires_in_s: 120 },
};
const CHART_CARD = {
  type: 'card', card_type: 'chart',
  data: {
    title: 'Bitcoin vs Gold', period: '1Y', period_text: 'over the past year', unit: '%',
    series: [
      { asset_id: 'BTC', name: 'Bitcoin', points: [['2025-10-15T00:00:00+00:00', 0], ['2026-04-15T00:00:00+00:00', 12.5], ['2026-10-15T00:00:00+00:00', 30.2]], change_pct: 30.2, change_text: 'up about 30%' },
      { asset_id: 'XAU', name: 'Gold', points: [['2025-10-15T00:00:00+00:00', 0], ['2026-04-15T00:00:00+00:00', 4.1], ['2026-10-15T00:00:00+00:00', -2.4]], change_pct: -2.4, change_text: 'down about 2.4%' },
    ],
    source: 'Binance price history, in baht at each day\'s exchange rate',
  },
};
const STEPS_CARD = {
  type: 'card', card_type: 'steps',
  data: { title: 'How to buy', topic: 'buy', steps: [
    { n: 1, title: 'Open the asset', text: 'Tap the asset in the Invest list.', show_me: [{ type: 'navigate', to: { tab: 'invest', view: 'invest' } }, { type: 'highlight', element_id: 'invest.asset.XAU' }] },
    { n: 2, title: 'Tap Buy', text: 'Then type the amount.', show_me: [] },
  ] },
};

describe('the backend\'s cards and screen actions', () => {
  it('passes the prototype\'s own actions, renames highlight, and drops anything the prototype cannot run', () => {
    expect(toPrototypeAction({ type: 'highlight', element_id: 'asset.chart' })).toEqual({ type: 'highlight', target: 'asset.chart' });
    expect(toPrototypeAction({ type: 'open_asset', asset: 'XAU' })).toEqual({ type: 'open_asset', asset: 'XAU' });
    expect(toPrototypeAction({ type: 'delete_account' })).toBeNull();
    for (const a of ['navigate', 'back', 'open_asset', 'set_period', 'set_filter', 'toggle_freeze', 'hide_balance', 'start_guide']) expect(SCREEN_ACTIONS.has(a)).toBe(true);
  });

  it('a buy: opens the asset, shows the trade card, and reads the card back exactly', () => {
    const r = toPrototypeReply({ text: "Here's your preview.", ui_actions: [{ type: 'open_asset', asset: 'XAU' }, TRADE_CARD] }, 'en');
    expect(r.reply.ui_actions).toEqual([{ type: 'open_asset', asset: 'XAU' }]);
    expect(r.trade).toMatchObject({ preview_id: 'pv_abc', amount: 995, fee: 5, total: 1000 });
    expect(r.reply.speech).toBe('nine hundred ninety-five baht into gold. Fee five baht. Total one thousand baht. Tap Confirm on the card when you are ready.');
  });

  it('a chart or steps card comes back separately, and the voice says just the reply line', () => {
    const chart = toPrototypeReply({ text: 'Bitcoin is up about 30% over the past year.', ui_actions: [CHART_CARD] }, 'en');
    expect(chart.chart).toMatchObject({ title: 'Bitcoin vs Gold', unit: '%' });
    expect(chart.reply.speech).toBe('Bitcoin is up about 30% over the past year.');
    expect(chart.reply.ui_actions).toEqual([]);
    expect(toPrototypeReply({ text: 'Here is how.', ui_actions: [STEPS_CARD] }, 'en').steps).toMatchObject({ title: 'How to buy' });
  });

  it('installBackend shows the chart card after the reply', async () => {
    let backend: ((q: string, ctx: unknown) => Promise<PrototypeReply>) | null = null;
    (window as unknown as { Icarus: unknown }).Icarus = { setBackend: (fn: typeof backend) => (backend = fn) };
    const showChart = vi.fn();
    const showTrade = vi.fn();
    installBackend({ url: 'http://be', userId: 'u_new', getInstance: () => null, showTrade, showChart, hideCards: () => undefined, cardDelayMs: 0,
      fetchImpl: vi.fn(async () => jsonResponse(200, { text: 'Up about 30%.', ui_actions: [CHART_CARD] })) as unknown as typeof fetch });
    await backend!('how did bitcoin do this year?', { screen: 'home' });
    await sleep(5);
    expect(showChart).toHaveBeenCalledWith(expect.objectContaining({ title: 'Bitcoin vs Gold' }), 'en');
    expect(showTrade).not.toHaveBeenCalled();
  });
});

describe('chart and steps cards', () => {
  afterEach(hideInfoCard);

  it('draws one line per series, in baht for one asset and in % when comparing', () => {
    const svg = chartSvg(CHART_CARD.data as never);
    expect(svg.querySelectorAll('path')).toHaveLength(2);
    expect(svg.getAttribute('aria-label')).toContain('Bitcoin: up about 30%');
    const labels = Array.from(svg.querySelectorAll('text')).map((t) => t.textContent);
    expect(labels).toContain('0%'); // the zero line of a % chart
    expect(axisLabel(2_729_983, 'THB')).toBe('฿2.7M');
    expect(axisLabel(69_203, 'THB')).toBe('฿69k');
    expect(axisLabel(950, 'THB')).toBe('฿950');
    expect(axisLabel(12.4, '%')).toBe('+12%');
  });

  it('a steps card lists the steps, and "Show me" runs the backend\'s pointing actions on the prototype', () => {
    const run = vi.fn();
    const el = showStepsCard(STEPS_CARD.data as never, { lang: 'en', getPhone: () => null, runActions: run });
    expect(el.textContent).toContain('How to buy');
    expect(el.textContent).toContain('Open the asset');
    const buttons = Array.from(el.querySelectorAll('button')).filter((b) => b.textContent === 'Show me');
    expect(buttons).toHaveLength(1); // step 2 has nothing to show
    buttons[0]!.click();
    expect(run).toHaveBeenCalledWith(STEPS_CARD.data.steps[0]!.show_me);
  });
});

describe('installBackend', () => {
  function install(fetchImpl: typeof fetch, proto: PrototypeLike = { ...fakeProto(), state: { asst: 'voice' } }) {
    let backend: ((q: string, ctx: unknown) => Promise<PrototypeReply>) | null = null;
    (window as unknown as { Icarus: unknown }).Icarus = { setBackend: (fn: typeof backend) => (backend = fn) };
    expect(installBackend({ url: 'http://be', userId: 'u_new', getInstance: () => proto, showTrade: vi.fn(), hideCards: () => undefined, fetchImpl, cardDelayMs: 0 })).toBe(true);
    return (q: string, ctx: unknown = { screen: 'home', language: 'en', asset: { id: 'XAU' } }) => backend!(q, ctx);
  }

  it('asks /chat in voice mode with the snapshot, and reads the buy back', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, BUY_REPLY)) as unknown as typeof fetch;
    const reply = await install(fetchImpl)('Put 1,000 baht in gold');
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls[0]!;
    expect(url).toBe('http://be/chat');
    expect(JSON.parse(init.body)).toMatchObject({ user_id: 'u_new', input_mode: 'voice', snapshot: { screen: 'home', asset: { id: 'XAU' } } });
    expect(reply.speech).toContain('Total one thousand ten baht');
    expect(reply.ui_actions).toHaveLength(5);
  });

  it("says the backend's own error message, or that the backend is not reachable", async () => {
    const busy = install(vi.fn(async () => jsonResponse(429, { detail: { code: 'rate_limited', message_en: 'Icarus is busy. Try again in a minute.', message_th: 'Icarus ยุ่งอยู่' } })) as unknown as typeof fetch);
    expect((await busy('hello')).text).toBe('Icarus is busy. Try again in a minute.');
    const down = install(vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch);
    const reply = await down('hello');
    expect(reply.text).toContain("can't reach the Icarus brain");
    expect(reply.sources[0]).toContain('not reachable');
  });
});

describe("inside the REAL prototype: the backend's buy actions drive Oasis's own screens", () => {
  let root: Root;
  let instance: (PrototypeLike & { state: Record<string, unknown> }) | null = null;
  afterEach(async () => {
    await act(async () => root.unmount());
    setMascotFallback(false);
  });

  it('opens gold, types 1,000, stops on review; the read-back matches what that screen shows', async () => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<div id="root"></div>';
    setMascotFallback(true);
    const app = createDcApp(HTML);
    installHelmet(app.helmet);
    root = createRoot(document.getElementById('root') as HTMLElement);
    await act(async () => {
      root.render(React.createElement(app.Root, { instanceRef: (c: unknown) => (instance = c as typeof instance) }));
    });
    const fetchImpl = vi.fn(async () => jsonResponse(200, BUY_REPLY)) as unknown as typeof fetch;
    installBackend({ url: 'http://be', userId: 'u_new', getInstance: () => instance, showTrade: vi.fn(), hideCards: () => undefined, fetchImpl });

    await act(async () => (window as unknown as { Icarus: { send: (t: string) => void } }).Icarus.send('Put 1,000 baht in gold'));
    await act(async () => sleep(6000)); // the prototype opens screens and types the amount one digit at a time

    const body = JSON.parse((fetchImpl as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls[0]![1].body);
    expect(body.snapshot.screen).toBe('home'); // the prototype's own getContext()
    expect(instance!.state).toMatchObject({ view: 'buy', buyStep: 'review', buyAmount: '1000', assetId: 'XAU', walletId: 'thb' });

    // The prototype's own numbers for that screen, and the line Icarus says about them.
    const shown = instance!.calc!('XAU', 1000, 'thb');
    expect(shown).toMatchObject({ amt: 1000, fee: 10, total: 1010, ok: true });
    expect(buyReadback(BUY_ACTIONS, undefined, instance, 'en')).toBe('one thousand baht into gold. Fee ten baht. Total one thousand ten baht. Tap Confirm purchase when you are ready.');
  }, 20_000);
});

describe('the trade card (an older backend that sends cards)', () => {
  const card = { preview_id: 'pv_abc', asset_id: 'gold', asset_name: 'Tokenized gold (PAX Gold)', side: 'buy', amount_thb: 1000, price_thb: 139137.82, unit: 'PAXG', freshness: 'live', fee_is_mock: true, fee_thb: 5, qty: 0.00715118, you_pay_thb: 1000, expires_in_s: 120, amount: 995, fee: 5, total: 1000, currency: 'THB' };

  it("shows the backend's numbers and confirms only on a tap", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { status: 'confirmed', transaction: { id: 'tx_1', qty: 0.00715118 }, cash_thb: 3000 })) as unknown as typeof fetch;
    const onConfirmed = vi.fn();
    const el = showTradeCard(card, { lang: 'en', backendUrl: 'http://be', userId: 'u_new', getPhone: () => null, fetchImpl, onConfirmed });
    expect(el.textContent).toContain('995.00 THB');
    expect(el.textContent).toContain('5.00 THB (demo fee)');
    expect(el.textContent).toContain('Price held for 2:00');
    expect(fetchImpl).not.toHaveBeenCalled();
    (el.querySelector('button') as HTMLButtonElement).click();
    await sleep(5);
    expect((fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls[0]![0]).toBe('http://be/trades/pv_abc/confirm');
    expect(onConfirmed).toHaveBeenCalledWith(expect.anything(), 'Done. You bought 0.00715118 PAXG of gold for 1,000.00 THB. Cash left: 3,000.00 THB.');
  });

  it("shows the backend's reason when it refuses, and stops offering Confirm when the price runs out", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(409, { detail: { code: 'preview_expired', message_en: 'That preview expired. Ask again for a fresh price.', message_th: 'x' } })) as unknown as typeof fetch;
    const el = showTradeCard(card, { lang: 'en', backendUrl: 'http://be', userId: 'u_new', getPhone: () => null, fetchImpl });
    (el.querySelector('button') as HTMLButtonElement).click();
    await sleep(5);
    expect(el.textContent).toContain('That preview expired.');
    vi.useFakeTimers();
    try {
      const timed = showTradeCard({ ...card, expires_in_s: 2 }, { lang: 'th', backendUrl: 'http://be', userId: 'u_new', getPhone: () => null });
      vi.advanceTimersByTime(3000);
      expect((timed.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
