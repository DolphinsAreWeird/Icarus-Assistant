// Bugs found by QA agents, each with the case that found it. The real prototype, with the backend demo adapter installed.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actionIsRunnable, cleanChart, cleanSteps, toPrototypeAction, toPrototypeReply } from '../src/backend-bridge';
import { FROZEN_MESSAGE, installCardGuard } from '../src/card-guard';
import { installDemoData } from '../src/demo-data';
import { createDcApp, installHelmet } from '../src/dc-runtime';
import { installIdleNudge, type NudgeReply } from '../src/idle-nudge';
import { setMascotFallback } from '../src/assets';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const HTML = readFileSync(path.join(__dirname, '../prototype/Icarus Prototype.dc.html'), 'utf8');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- the backend's demo bundle, as GET /demo/state/{user} returns it ----------
const chartFor = (price: number) => ({ display_version: 'v1', period: '1M', source: { observed_at: '2026-10-15T00:00:00Z' },
  points: [{ at: '2026-09-15T00:00:00Z', price: String(price * 0.9) }, { at: '2026-10-15T00:00:00Z', price: String(price) }] });
const BUNDLE = {
  mode: 'simulated', currency: 'THB', user_id: 'u', display_name: 'Test', cash_thb: 5000, holdings: {}, notice: 'demo',
  fees: { trading_fee_pct: 0.25, min_fee_thb: 5, min_buy_thb: 100 }, transactions: [],
  assets: Object.fromEntries(['BTC', 'ETH', 'XAU'].map((id) => [id, { price_thb: 100000, freshness: 'live', charts: Object.fromEntries(['1D', '1W', '1M', '3M', '1Y', 'ALL'].map((p) => [p, chartFor(100000)])) }])),
};
function backendFetch(bundle: unknown = BUNDLE) {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string, init?: { body?: string }) => {
    calls.push(url.replace(/^.*\/(demo|trades)/, '/$1'));
    const amount = url.includes('/trades/preview') ? JSON.parse(init!.body!).amount_thb : 0;
    const json = url.includes('/trades/preview')   // the full shape the adapter checks before it will show a Review screen
      ? { preview_id: 'p', user_id: 'u', status: 'pending', asset_id: 'gold', side: 'buy', unit: 'PAXG', amount_thb: amount, you_pay_thb: amount,
          fee_thb: 5, price_thb: 100000, qty: (amount - 5) / 100000, expires_at: Date.now() / 1000 + 120 }
      : url.includes('/confirm') ? { status: 'confirmed' } : bundle;
    return { ok: true, status: 200, json: async () => json } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

type Proto = Record<string, any>;
let root: Root;
let proto: Proto;

beforeEach(async () => {
  localStorage.clear();
  document.head.innerHTML = '';
  document.body.innerHTML = '<div id="root"></div>';
  setMascotFallback(true);
  const app = createDcApp(HTML);
  installHelmet(app.helmet);
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => {
    root.render(React.createElement(app.Root, { instanceRef: (c: unknown) => { if (c) proto = c as Proto; } }));
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  delete (window as { Icarus?: unknown }).Icarus;
  setMascotFallback(false);
});

describe('a frozen card blocks Confirm even with the backend demo adapter', () => {
  it('refuses to review and to confirm, and sends nothing to the backend', async () => {
    const { fn, calls } = backendFetch();
    const errors: string[] = [];
    const demo = installDemoData(proto, 'http://be', 'u', (m) => errors.push(m), fn);
    installCardGuard(proto);
    await act(async () => { await demo.refresh(); });
    await act(async () => proto.setState({ tab: 'invest', view: 'buy', assetId: 'XAU', buyStep: 'amount', buyAmount: '1000' }));
    await act(async () => { await proto.toReview(); });                       // a real preview exists, then the card is frozen
    expect(calls).toContain('/trades/preview');
    expect(proto.state.buyStep).toBe('review');
    await act(async () => proto.setState({ frozen: true }));
    const before = calls.length;
    await act(async () => { await proto.confirm(); });
    expect(proto.state.buyStep).toBe('review');                                // not 'done'
    expect(calls.length).toBe(before);                                          // POST /confirm never went out
    expect(document.body.textContent).toContain(FROZEN_MESSAGE.en);            // and the user is told why
    await act(async () => proto.setState({ buyStep: 'amount' }));
    await act(async () => { await proto.toReview(); });
    expect(proto.state.buyStep).toBe('amount');                                // Review is refused too
    await act(async () => proto.setState({ frozen: false }));                 // unfreeze: review again (the adapter forgot the old preview), then confirm
    await act(async () => { await proto.toReview(); });
    expect(proto.state.buyStep).toBe('review');
    await act(async () => { await proto.confirm(); });
    expect(errors, errors.join(' | ')).toEqual([]);
    expect(proto.state.buyStep).toBe('done');                                  // unfreezing restores it
  });

  it('confirm only works on the review screen, and cannot buy twice', async () => {
    installCardGuard(proto);
    const cash = proto.state.thbBal;
    await act(async () => proto.setState({ tab: 'invest', view: 'buy', assetId: 'XAU', buyStep: 'amount', buyAmount: '1000' }));
    await act(async () => proto.confirm());                                     // from the amount screen: nothing
    expect(proto.state.thbBal).toBe(cash);
    await act(async () => proto.setState({ buyStep: 'review' }));
    await act(async () => proto.confirm());
    const after = proto.state.thbBal;
    expect(after).toBeLessThan(cash);
    await act(async () => proto.confirm());                                     // on the done screen: nothing more
    expect(proto.state.thbBal).toBe(after);
  });

  it('installing the guard twice does not stack wrappers', () => {
    installCardGuard(proto);
    const calc = proto.calc;
    installCardGuard(proto);
    expect(proto.calc).toBe(calc);
  });
});

describe('a bad demo bundle never leaves the app half-set-up', () => {
  it.each([
    ['no transactions', { ...BUNDLE, transactions: undefined }],
    ['no fees', { ...BUNDLE, fees: undefined }],
    ['an asset without charts', { ...BUNDLE, assets: { XAU: { price_thb: 1 } } }],
    ['no cash', { ...BUNDLE, cash_thb: 'lots' }],
  ])('rejects a bundle with %s and keeps the prototype as it was', async (_name, bad) => {
    const cash = proto.state.thbBal;
    const demo = installDemoData(proto, 'http://be', 'u', () => undefined, backendFetch(bad).fn);
    await expect(demo.refresh()).rejects.toThrow(/Unsupported demo bundle/);
    expect(proto.state.thbBal).toBe(cash);
    expect(() => proto.getContext()).not.toThrow();                            // the screens still render
    expect(demo.ready()).toBe(false);
  });
});

describe('the bridge never lets a malformed backend reply reach the app', () => {
  it('drops unknown or malformed screen actions', () => {
    const bad = [{ type: 'open_asset', asset: 'SOL' }, { type: 'open_asset' }, { type: 'start_buy', asset: 'SOL' }, { type: 'set_filter', filter: 'zzz' },
      { type: 'set_period', period: '5Y' }, { type: 'select_wallet', wallet: 'eur' }, { type: 'type_amount', value: 'abc' }, { type: 'type_amount', value: -5 },
      { type: 'type_amount', value: NaN }, { type: 'navigate', to: { tab: 'settings' } }, { type: 'navigate' }, { type: 'toggle_freeze', value: 'yes' },
      { type: 'confirm' }, { type: 'execute_trade' }, null, 'x', 5];
    for (const a of bad) expect(toPrototypeAction(a), JSON.stringify(a)).toBeNull();
    const good = [{ type: 'open_asset', asset: 'XAU' }, { type: 'set_period', period: '1Y' }, { type: 'set_filter', filter: 'Crypto' }, { type: 'type_amount', value: 1000 },
      { type: 'select_wallet', wallet: 'thb' }, { type: 'navigate', to: { tab: 'invest', view: 'portfolio' } }, { type: 'toggle_freeze', value: true }, { type: 'review' }];
    for (const a of good) expect(actionIsRunnable(a), JSON.stringify(a)).toBe(true);
  });

  it('turns odd shapes into safe ones instead of throwing', () => {
    const odd = [
      { text: 'a', ui_actions: { not: 'a list' } }, { text: 'a', sources: 'abc' }, { text: 'a', sources: [null, 5, 'x'] },
      { text: 'a', suggestions: 'abc' }, { text: 'a', suggestions: [1, null, 'ok'] }, { text: 'a', ui_actions: [null, 5, {}, { type: 5 }] },
    ];
    for (const r of odd) {
      const { reply } = toPrototypeReply(r as never, 'en');
      expect(Array.isArray(reply.ui_actions) && Array.isArray(reply.sources) && Array.isArray(reply.suggestions)).toBe(true);
    }
    expect(toPrototypeReply({ text: 'a', suggestions: [1, null, 'ok'] } as never, 'en').reply.suggestions).toEqual(['ok']);
  });

  it('cleans chart and steps cards, or drops them, so drawing never throws', () => {
    expect(cleanChart({ title: 'T', series: [{ name: 'A' }] })).toBeNull();                  // no points
    expect(cleanChart({ title: 'T' })).toBeNull();                                           // no series
    expect(cleanChart({ title: 'T', series: [{ name: 'A', points: [['2026-01-01', 1]] }] })).toBeNull(); // one point: nothing to draw
    const ok = cleanChart({ title: 'T', series: [{ name: 'A', points: [['2026-01-01', 1], ['2026-01-02', NaN], ['2026-01-03', 3], 'junk'] }, 7] }) as { series: Array<{ points: unknown[] }> };
    expect(ok.series).toHaveLength(1);
    expect(ok.series[0]!.points).toHaveLength(2);                                            // the NaN and junk points are gone
    expect(cleanSteps({ title: 'T' })).toBeNull();
    expect(cleanSteps({ title: 'T', steps: 'abc' })).toBeNull();
    const steps = cleanSteps({ title: 'T', steps: [null, { n: 1, title: 'a', text: 'b', show_me: 'review' }, { title: 'c', show_me: [null, { type: 'open_asset', asset: 'XAU' }, { type: 'confirm' }] }] }) as { steps: Array<{ show_me: unknown[] }> };
    expect(steps.steps).toHaveLength(2);
    expect(steps.steps[0]!.show_me).toEqual([]);                                             // a string is not a list of actions
    expect(steps.steps[1]!.show_me).toEqual([{ type: 'open_asset', asset: 'XAU' }]);         // 'confirm' and null are dropped
  });
});

describe('idle nudge hardening', () => {
  const phone = () => document.querySelector('[data-screen-label="Phone"]') as Element;
  const IDLE = 60;

  it('survives suggestions that are not a list, and a highlight that is not an id', async () => {
    const bad = { reason: 'x', text: 'Hello', highlight: 5, suggestions: 'abc' } as unknown as NudgeReply;
    const stop = installIdleNudge(proto, { fetchNudge: async () => bad, getPhone: phone, idleMs: IDLE, checkMs: 10 });
    await act(async () => proto.setState({ tab: 'invest', view: 'buy', assetId: 'XAU', buyStep: 'amount', buyAmount: '50' }));
    await act(async () => { await sleep(IDLE * 3); });
    expect(proto.state.fabBubble).toBe('Hello');
    expect(proto.state.messages.at(-1).suggestions).toEqual([]);
    expect(document.querySelector('[data-screen-label="Phone"]')).toBeTruthy();   // the app did not blank
    stop();
  });

  it('installing twice gives one nudge, not two', async () => {
    const ask = vi.fn(async (): Promise<NudgeReply> => ({ reason: 'r', text: 'Hi there', highlight: null, suggestions: [] }));
    installIdleNudge(proto, { fetchNudge: ask, getPhone: phone, idleMs: IDLE, checkMs: 10 });
    const stop = installIdleNudge(proto, { fetchNudge: ask, getPhone: phone, idleMs: IDLE, checkMs: 10 });
    await act(async () => proto.setState({ tab: 'invest', view: 'buy', assetId: 'XAU', buyStep: 'amount', buyAmount: '50' }));
    await act(async () => { await sleep(IDLE * 4); });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(proto.state.messages.filter((m: { text: string }) => m.text === 'Hi there')).toHaveLength(1);
    stop();
  });
});
