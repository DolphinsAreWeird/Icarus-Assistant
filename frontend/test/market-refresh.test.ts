import { readFileSync } from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDcApp } from '../src/dc-runtime';
import { setMascotFallback } from '../src/assets';
import { installDemoData, LIVE_MAX_AGE_MS, REFRESH_INTERVAL_MS, type DemoBundle } from '../src/demo-data';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const html = readFileSync(path.join(__dirname, '../prototype/Icarus Prototype.dc.html'), 'utf8');
let root: Root, proto: any, stop: (() => void) | undefined;
const T0 = Date.parse('2026-10-16T09:00:00Z');
const bundle = (price = 10000, asOf = T0, freshness = 'live'): DemoBundle => ({ mode: 'simulated', currency: 'THB', user_id: 'u_new', display_name: 'Test', cash_thb: 5000,
  holdings: { BTC: 0, ETH: 0, XAU: 1 }, fees: { trading_fee_pct: .25, min_fee_thb: 5, min_buy_thb: 100 }, transactions: [], notice: 'Simulated',
  assets: Object.fromEntries(['BTC', 'ETH', 'XAU'].map(id => [id, { price_thb: price, freshness, as_of: new Date(asOf).toISOString(), charts: {} }])) });
const setVisibility = (v: 'visible' | 'hidden') => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(T0);
  setVisibility('visible');
  document.body.innerHTML = '<div id="root"></div>';
  setMascotFallback(true);
  const app = createDcApp(html);
  root = createRoot(document.getElementById('root')!);
  await act(async () => root.render(React.createElement(app.Root, { instanceRef: (p: unknown) => { proto = p; } })));
});
afterEach(async () => { stop?.(); stop = undefined; await act(async () => root.unmount()); delete (window as any).Icarus; vi.useRealTimers(); setVisibility('visible'); });

const stateCalls = (fetcher: ReturnType<typeof vi.fn>) => fetcher.mock.calls.filter(([u]) => String(u).includes('/demo/state/')).length;
const setup = async (respond: () => Response | Promise<Response>, autoStart = true) => {
  const fetcher = vi.fn(async (url: any) => String(url).includes('/demo/state/') ? respond() : Response.json({}));
  const demo = installDemoData(proto, 'http://be', 'u_new', vi.fn(), fetcher as any);
  await act(async () => demo.refresh());
  if (autoStart) stop = demo.startAutoRefresh();
  return { demo, fetcher, states: () => stateCalls(fetcher) };
};
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

it('ages a live label to delayed after the backend threshold, with no network', async () => {
  await setup(() => Response.json(bundle()), false);
  const label = () => proto.renderVals().asset.change24;
  expect(label()).toMatch(/^Live price/);
  vi.setSystemTime(T0 + LIVE_MAX_AGE_MS - 1000);
  expect(label()).toMatch(/^Live price/);
  vi.setSystemTime(T0 + LIVE_MAX_AGE_MS + 1000);
  const view = proto.renderVals();
  expect(view.asset.change24).toMatch(/^Delayed price · \d+ min old/);
  expect(view.asset.info[0].v).toMatch(/^Delayed, /);
  expect(view.pfChange).toBe('Value at last known prices');
  expect(view.asset.price).toBe('฿10,000.00'); // last data is kept
});

it('a future-dated observation (server clock ahead) cannot stay live past the threshold', async () => {
  await setup(() => Response.json(bundle(10000, T0 + 4 * 60_000)), false);
  expect(proto.renderVals().asset.change24).toMatch(/^Live price/);
  vi.setSystemTime(T0 + LIVE_MAX_AGE_MS + 1000);
  expect(proto.renderVals().asset.change24).toMatch(/^Delayed price · 2 min old/);
});

it('a delayed observation shows its real age, not the time since it was fetched', async () => {
  await setup(() => Response.json(bundle(10000, T0 - 3 * 3_600_000, 'delayed')), false);
  expect(proto.renderVals().asset.change24).toMatch(/^Delayed price · 3 h old/);
});

it('a live observation that only looks old because our clock runs ahead is aged from receipt', async () => {
  await setup(() => Response.json(bundle(10000, T0 - 10 * 60_000)), false);
  expect(proto.renderVals().asset.change24).toMatch(/^Live price/);
  vi.setSystemTime(T0 + LIVE_MAX_AGE_MS + 1000);
  expect(proto.renderVals().asset.change24).toMatch(/^Delayed price · 2 min old/);
});

it('failed background refreshes keep the data and the timer re-renders the aged label', async () => {
  let fail = false;
  const { states } = await setup(() => { if (fail) throw new Error('down'); return Response.json(bundle()); });
  fail = true;
  await advance(LIVE_MAX_AGE_MS + REFRESH_INTERVAL_MS);
  expect(states()).toBeGreaterThan(2);
  expect(document.body.textContent).not.toMatch(/Live price/);
  expect(proto.renderVals().asset.price).toBe('฿10,000.00');
});

it('refreshes periodically while visible and keeps labels live while observations are new', async () => {
  let n = 0;
  const { states } = await setup(() => Response.json(bundle(10000 + ++n, Date.now())));
  const before = states();
  await advance(REFRESH_INTERVAL_MS + 1);
  expect(states()).toBe(before + 1);
  await advance(LIVE_MAX_AGE_MS * 3);
  expect(proto.renderVals().asset.change24).toMatch(/^Live price/);
});

it('does not overlap requests', async () => {
  let release!: () => void, calls = 0;
  const { states } = await setup(() => { calls++; return calls === 1 ? Response.json(bundle()) : new Promise<Response>(r => { release = () => r(Response.json(bundle())); }); });
  await advance(REFRESH_INTERVAL_MS * 3);
  expect(states()).toBe(2); // the initial load plus one still pending
  release();
  await advance(1);
  await advance(REFRESH_INTERVAL_MS);
  expect(states()).toBe(3);
});

it('refreshes on focus, visibility return and online, and pauses while hidden', async () => {
  const { states } = await setup(() => Response.json(bundle()));
  let n = states();
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(states()).toBe(++n);
  await act(async () => { window.dispatchEvent(new Event('online')); });
  expect(states()).toBe(++n);
  setVisibility('hidden');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
  await advance(REFRESH_INTERVAL_MS * 4);
  expect(states()).toBe(n);
  setVisibility('visible');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(states()).toBe(n + 1);
});

it('offline-sourced prices are never labelled live', async () => {
  await setup(() => Response.json(bundle(10000, T0, 'offline')), false);
  expect(proto.renderVals().asset.change24).toMatch(/^Saved price/);
});

it('a background refresh does not change a reviewed purchase, and resumes after the review ends', async () => {
  let market = bundle();
  const preview = { preview_id: 'pv-1', user_id: 'u_new', side: 'buy', status: 'pending', asset_id: 'gold', amount_thb: 1000, fee_thb: 5, qty: .0995, price_thb: 10000, unit: 'PAXG', you_pay_thb: 1000, expires_at: Date.now() / 1000 + 600 };
  const fetcher = vi.fn(async (url: any) => Response.json(String(url).endsWith('/preview') ? preview : String(url).endsWith('/confirm') ? { status: 'confirmed' } : market));
  const demo = installDemoData(proto, 'http://be', 'u_new', vi.fn(), fetcher as any);
  await act(async () => demo.refresh());
  stop = demo.startAutoRefresh();
  await act(async () => proto.setState({ tab: 'invest', view: 'buy', buyAmount: '1000', assetId: 'XAU', walletId: 'thb' }));
  await act(async () => proto.toReview());
  expect(proto.state.buyStep).toBe('review');
  const n = stateCalls(fetcher);
  market = { ...bundle(80000, Date.now()), fees: { ...bundle().fees, min_fee_thb: 99 } };
  await advance(REFRESH_INTERVAL_MS * 2);
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(stateCalls(fetcher)).toBe(n); // refresh deferred during review
  expect(proto.renderVals().buy).toMatchObject({ fee: '฿5.00', total: '฿1,000.00', unitPrice: '1 PAXG = ฿10,000.00' });
  expect(proto.state.buyStep).toBe('review');
  await act(async () => proto.confirm());
  expect(fetcher.mock.calls.filter(([u]) => String(u).endsWith('/confirm')).map(([u]) => u)).toEqual(['http://be/trades/pv-1/confirm']);
  await advance(REFRESH_INTERVAL_MS + 1);
  expect(proto.renderVals().asset.price).toBe('฿80,000.00'); // refreshed once the review is over
});

it('screen-wide price wording follows the aged freshness, and the judge copy uses it', async () => {
  const { withJudgeCopy, LIVE_DATA_COPY } = await import('../src/judge-copy');
  expect(LIVE_DATA_COPY.map(([, to]) => to).join('|')).not.toMatch(/Live prices|are live/);
  expect(withJudgeCopy(html, { liveData: true })).toContain('{{ pricesHeader }}');
  await setup(() => Response.json(bundle()), false);
  let v = proto.renderVals();
  expect([v.pricesHeader, v.pricesNote, v.buyNote]).toEqual(['Live prices, in baht', 'Prices are live, in baht; the account is a demo.', expect.stringMatching(/^Prices are live; the account/)]);
  vi.setSystemTime(T0 + LIVE_MAX_AGE_MS + 1000);
  v = proto.renderVals();
  expect(v.pricesHeader).toBe('Delayed prices, in baht');
  expect(v.pricesNote).toContain('delayed');
  expect(v.buyNote).toMatch(/^Prices are delayed;/);
});

it('offline prices say saved, never live', async () => {
  await setup(() => Response.json(bundle(10000, T0, 'offline')), false);
  expect(proto.renderVals().pricesHeader).toBe('Saved prices, in baht');
});

it('with the judge copy, the screen says loading before the account arrives and never shows a raw placeholder', async () => {
  const { withJudgeCopy } = await import('../src/judge-copy');
  const app = createDcApp(withJudgeCopy(html, { liveData: true }));
  const host = document.createElement('div');
  document.body.append(host);
  const r = createRoot(host);
  let p: any;
  await act(async () => r.render(React.createElement(app.Root, { instanceRef: (x: unknown) => { p = x; } })));
  await act(async () => p.setState({ tab: 'invest', view: 'invest' }));
  // The page rendered before the overrides exist: the placeholder is empty text, never "{{ pricesHeader }}".
  expect(host.innerHTML).not.toContain('{{');
  await act(async () => { installDemoData(p, 'http://be', 'u_new', vi.fn(), vi.fn(() => new Promise<Response>(() => {})) as any); });
  expect(host.textContent).toContain('Loading prices…');
  expect(host.innerHTML).not.toContain('{{');
  expect(host.textContent).not.toMatch(/Live prices, in baht|Prices are live, in baht/);
  await act(async () => r.unmount());
  host.remove();
});
