import { readFileSync } from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDcApp } from '../src/dc-runtime';
import { setMascotFallback } from '../src/assets';
import { installDemoData, type DemoBundle } from '../src/demo-data';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const html = readFileSync(path.join(__dirname, '../prototype/Icarus Prototype.dc.html'), 'utf8');
let root: Root, proto: any;
const data: DemoBundle = { mode: 'simulated', currency: 'THB', user_id: 'u_new', display_name: 'Test', cash_thb: 5000,
  holdings: { BTC: 0, ETH: 0, XAU: 1 }, fees: { trading_fee_pct: .25, min_fee_thb: 5, min_buy_thb: 100 }, transactions: [], notice: 'Simulated',
  assets: Object.fromEntries(['BTC', 'ETH', 'XAU'].map(id => [id, { price_thb: 10000, freshness: 'offline', charts: { '1M': {
    period: '1m', display_version: `chart-${id}`, points: [{ at: '2026-09-01T00:00:00+00:00', price: '9000' }, { at: '2026-10-01T00:00:00+00:00', price: '10000' }], source: { observed_at: '2026-10-01T00:00:00+00:00' } } } }])) };

beforeEach(async () => {
  document.body.innerHTML = '<div id="root"></div>';
  setMascotFallback(true);
  const app = createDcApp(html);
  root = createRoot(document.getElementById('root')!);
  await act(async () => root.render(React.createElement(app.Root, { instanceRef: (p: unknown) => { proto = p; } })));
});
afterEach(async () => { await act(async () => root.unmount()); delete (window as any).Icarus; });

it('renders backend THB prices and cash, uses exact chart points and one fee rule', async () => {
  const fetcher = vi.fn(async () => Response.json(data));
  const demo = installDemoData(proto, 'http://be', 'u_new', vi.fn(), fetcher);
  await act(async () => demo.refresh());
  expect(proto.calc('XAU', 1000, 'thb')).toMatchObject({ amt: 995, fee: 5, total: 1000, qty: .0995, ok: true });
  expect(proto.calc('XAU', 2002, 'thb').fee).toBe(5.01);
  expect(proto.assetSeries('XAU', '1M')).toEqual([9000, 10000]);
  const view = proto.renderVals();
  expect(view.totalBal).toBe('฿15,000.00');
  expect(view.assetRows.map((a: any) => a.id)).toEqual(['BTC', 'ETH', 'XAU']);
  expect(view.asset.price).toBe('฿10,000.00');
  // Holdings are valued at the backend's prices; nothing claims a return the account doesn't have.
  expect(view.pfChange).toBe('Value at last known prices'); // the fixture prices are offline, so not called live
  expect(view.pfChange).not.toMatch(/return|%/);
  expect(proto.getContext()).toMatchObject({ currency: 'THB', screen_revision: 'screen-1', display_version: 'chart-XAU' });
  const first = proto.getContext().screen_revision;
  await act(async () => proto.openAsset('BTC'));
  expect(proto.getContext().screen_revision).not.toBe(first);
});

it('manual review prepares a server preview and only a confirm tap changes the account', async () => {
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    if (String(url).endsWith('/preview')) return Response.json({ preview_id: 'pv-test', side: 'buy', asset_id: 'gold', amount_thb: 1000, fee_thb: 5, qty: .0995, price_thb: 10000, unit: 'PAXG', you_pay_thb: 1000, expires_at: Date.now() / 1000 + 120 });
    if (String(url).endsWith('/confirm')) return Response.json({ status: 'confirmed' });
    const confirmed = fetcher.mock.calls.some(([u]) => String(u).endsWith('/confirm'));
    return Response.json(confirmed ? { ...data, cash_thb: 4000, holdings: { ...data.holdings, XAU: 1.0995 } } : data);
  });
  const onError = vi.fn();
  const demo = installDemoData(proto, 'http://be', 'u_new', onError, fetcher);
  await act(async () => { await demo.refresh(); proto.setState({ buyAmount: '1000', assetId: 'XAU', tab: 'invest', view: 'buy' }); });
  await act(async () => proto.toReview());
  expect(proto.state.buyStep).toBe('review');
  expect(proto.state.thbBal).toBe(5000);
  expect(fetcher.mock.calls.some(([u]) => String(u).endsWith('/confirm'))).toBe(false);
  await act(async () => proto.confirm());
  expect(proto.state.thbBal).toBe(4000);
  expect(proto.state.hold.XAU).toBe(1.0995);
  expect(proto.state.buyStep).toBe('done');
  expect(onError).not.toHaveBeenCalled();
});

it('prevents a changed manual order from using the previous preview', async () => {
  const fetcher = vi.fn(async (url: string | URL | Request) => Response.json(String(url).endsWith('/preview')
    ? { preview_id: 'pv', side: 'buy', asset_id: 'gold', amount_thb: 1000, fee_thb: 5, qty: .0995, price_thb: 10000, unit: 'PAXG', you_pay_thb: 1000, expires_at: Date.now() / 1000 + 120 } : data));
  const error = vi.fn();
  const demo = installDemoData(proto, 'http://be', 'u_new', error, fetcher);
  await act(async () => { await demo.refresh(); proto.setState({ buyAmount: '1000', tab: 'invest', view: 'buy' }); });
  await act(async () => proto.toReview());
  await act(async () => proto.setState({ buyAmount: '2000' }));
  await act(async () => proto.confirm());
  expect(error).toHaveBeenCalledWith('Review the amount again before confirming.');
  expect(fetcher.mock.calls.some(([u]) => String(u).endsWith('/confirm'))).toBe(false);
});

const serverPreview = (overrides: Record<string, unknown> = {}) => ({ preview_id: 'pv-original', user_id: 'u_new', side: 'buy', status: 'pending',
  asset_id: 'gold', amount_thb: 1000.49, fee_thb: 17.25, qty: .049162, price_thb: 20000, unit: 'PAXG', you_pay_thb: 1000.49,
  expires_at: Date.now() / 1000 + 120, ...overrides });
const order = async () => act(async () => proto.setState({ tab: 'invest', view: 'buy', buyAmount: '1000.49', assetId: 'XAU', walletId: 'thb' }));

it('manual review renders server fee, price and quantity even when the bundle changes', async () => {
  const preview = serverPreview();
  let market = data;
  const fetcher = vi.fn(async (url: any) => Response.json(String(url).endsWith('/preview') ? preview : String(url).endsWith('/confirm') ? { status: 'confirmed' } : market));
  const demo = installDemoData(proto, 'http://be', 'u_new', vi.fn(), fetcher);
  await act(async () => demo.refresh()); await order();
  await act(async () => proto.toReview());
  market = { ...data, fees: { ...data.fees, min_fee_thb: 99 }, assets: { ...data.assets, XAU: { ...data.assets.XAU!, price_thb: 80000 } } };
  await act(async () => demo.refresh());
  expect(proto.renderVals().buy).toMatchObject({ amt: '฿983.24', fee: '฿17.25', total: '฿1,000.49', unitPrice: '1 PAXG = ฿20,000.00' });
  expect(document.body.textContent).toContain('0.049162 PAXG');
  expect(document.body.textContent).toContain('฿20,000.00');
  await act(async () => proto.confirm());
  expect(fetcher.mock.calls.filter(([u]) => String(u).endsWith('/preview'))).toHaveLength(1);
  expect(fetcher.mock.calls.filter(([u]) => String(u).endsWith('/confirm')).map(([u]) => u)).toEqual(['http://be/trades/pv-original/confirm']);
  expect(proto.state.lastBuy).toMatchObject({ fee: 17.25, total: 1000.49, qty: .049162 });
});

it('requires a new review and a separate tap after expiry', async () => {
  const clock = vi.spyOn(Date, 'now');
  const start = Date.now(); clock.mockReturnValue(start);
  const fetcher = vi.fn(async (url: any) => Response.json(String(url).endsWith('/preview') ? serverPreview() : String(url).endsWith('/confirm') ? { status: 'confirmed' } : data));
  const demo = installDemoData(proto, 'http://be', 'u_new', vi.fn(), fetcher);
  try {
    await act(async () => demo.refresh()); await order(); await act(async () => proto.toReview());
    clock.mockReturnValue(start + 121000);
    await act(async () => proto.confirm());
    expect(proto.state.buyStep).toBe('amount');
    expect(fetcher.mock.calls.filter(([u]) => String(u).endsWith('/preview'))).toHaveLength(1);
    expect(fetcher.mock.calls.some(([u]) => String(u).endsWith('/confirm'))).toBe(false);
    await act(async () => proto.toReview());
    expect(fetcher.mock.calls.some(([u]) => String(u).endsWith('/confirm'))).toBe(false);
    await act(async () => proto.confirm());
    expect(proto.state.buyStep).toBe('done');
  } finally { clock.mockRestore(); }
});

it.each(['preview_cancelled', 'preview_expired'])('server %s invalidates review without creating a replacement', async code => {
  const fetcher = vi.fn(async (url: any) => String(url).endsWith('/confirm') ? Response.json({ detail: { code, message_en: code } }, { status: 409 }) : Response.json(String(url).endsWith('/preview') ? serverPreview() : data));
  const demo = installDemoData(proto, 'http://be', 'u_new', vi.fn(), fetcher);
  await act(async () => demo.refresh()); await order(); await act(async () => proto.toReview());
  await act(async () => proto.confirm()); await act(async () => proto.confirm());
  expect(proto.state.buyStep).toBe('amount');
  expect(fetcher.mock.calls.filter(([u]) => String(u).endsWith('/preview'))).toHaveLength(1);
  expect(fetcher.mock.calls.filter(([u]) => String(u).endsWith('/confirm'))).toHaveLength(1);
});

it('double tap sends one request and a response-loss retry retains the original ID even after expiry', async () => {
  let rejectConfirm!: (e: Error) => void;
  let confirms = 0;
  const fetcher = vi.fn(async (url: any) => {
    if (String(url).endsWith('/confirm')) {
      confirms++;
      if (confirms === 1) return new Promise<Response>((_resolve, reject) => { rejectConfirm = reject; });
      return Response.json({ status: 'confirmed' });
    }
    return Response.json(String(url).endsWith('/preview') ? serverPreview({ expires_at: Date.now() / 1000 + 1 }) : data);
  });
  const demo = installDemoData(proto, 'http://be', 'u_new', vi.fn(), fetcher);
  await act(async () => demo.refresh()); await order(); await act(async () => proto.toReview());
  let first!: Promise<void>;
  await act(async () => { first = proto.confirm(); void proto.confirm(); });
  expect(confirms).toBe(1);
  await act(async () => { rejectConfirm(new Error('Response lost')); await first; });
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000);
  try { await act(async () => proto.confirm()); } finally { clock.mockRestore(); }
  expect(fetcher.mock.calls.filter(([u]) => String(u).endsWith('/confirm')).map(([u]) => u)).toEqual(['http://be/trades/pv-original/confirm', 'http://be/trades/pv-original/confirm']);
  expect(fetcher.mock.calls.filter(([u]) => String(u).endsWith('/preview'))).toHaveLength(1);
  expect(proto.state.buyStep).toBe('done');
});

it.each([{ buyAmount: '1000' }, { assetId: 'BTC' }])('changing and restoring order %j still requires review', async patch => {
  const fetcher = vi.fn(async (url: any) => Response.json(String(url).endsWith('/preview') ? serverPreview() : data));
  const demo = installDemoData(proto, 'http://be', 'u_new', vi.fn(), fetcher);
  await act(async () => demo.refresh()); await order(); await act(async () => proto.toReview());
  await act(async () => proto.setState(patch)); await order(); await act(async () => proto.confirm());
  expect(proto.state.buyStep).toBe('amount');
  expect(fetcher.mock.calls.some(([u]) => String(u).endsWith('/confirm'))).toBe(false);
});

it('does not review a late manual preview after the amount changed', async () => {
  let resolvePreview!: (response: Response) => void;
  const fetcher = vi.fn(async (url: any) => String(url).endsWith('/preview') ? new Promise<Response>(resolve => { resolvePreview = resolve; }) : Response.json(data));
  const demo = installDemoData(proto, 'http://be', 'u_new', vi.fn(), fetcher);
  await act(async () => demo.refresh()); await order();
  let review!: Promise<void>;
  await act(async () => { review = proto.toReview(); });
  await act(async () => proto.setState({ buyAmount: '1000' }));
  await act(async () => { resolvePreview(Response.json(serverPreview())); await review; });
  expect(proto.state.buyStep).toBe('amount');
  await act(async () => proto.confirm());
  expect(fetcher.mock.calls.some(([u]) => String(u).endsWith('/confirm'))).toBe(false);
});

it('lists stocks between crypto and gold, with gold last, and a tap asks Icarus for the chart', async () => {
  const w = (name: string, ticker: string) => ({ name, ticker, mono: ticker[0], bg: '#123456', price_thb: 12000.5, change_1d_pct: -1.25, spark: [1, 2, 3, 2] });
  const withWatch = { ...data, watchlist: { NVDA: w('Nvidia', 'NVDA'), AAPL: w('Apple', 'AAPL'), BAD: { name: 'Broken' } } } as unknown as DemoBundle;
  const fetcher = vi.fn(async () => Response.json(withWatch));
  const demo = installDemoData(proto, 'http://be', 'u_new', vi.fn(), fetcher);
  await act(async () => demo.refresh());
  expect(proto.renderVals().filters.map((f: any) => f.label)).toEqual(['All', 'Crypto', 'Stocks']); // no Gold tab
  expect(proto.renderVals().assetRows.map((a: any) => a.id)).toEqual(['BTC', 'ETH', 'NVDA', 'AAPL', 'XAU']); // gold last, the broken entry left out
  await act(async () => proto.setState({ filter: 'Stocks' }));
  const rows = proto.renderVals().assetRows;
  expect(rows.map((a: any) => a.id)).toEqual(['NVDA', 'AAPL']);
  expect(rows[0]).toMatchObject({ name: 'Nvidia', price: '฿12,000.50', change: '−1.25% 1D', color: '#C8312E' });
  expect(rows[0].spark).toMatch(/^M0\.0 /);
  await act(async () => proto.setState({ filter: 'Crypto' }));
  expect(proto.renderVals().assetRows.map((a: any) => a.id)).toEqual(['BTC', 'ETH']);
  await act(async () => proto.setState({ filter: 'Stocks' }));
  const send = vi.spyOn(proto, 'send').mockImplementation(() => undefined);
  proto.renderVals().assetRows[0].onOpen({ stopPropagation: () => undefined });
  expect(send).toHaveBeenCalledWith('How did Nvidia do?');
});
