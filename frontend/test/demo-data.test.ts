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
  expect(view.pfChange).toContain('no portfolio return history');
  expect(proto.getContext()).toMatchObject({ currency: 'THB', screen_revision: 'screen-1', display_version: 'chart-XAU' });
  const first = proto.getContext().screen_revision;
  await act(async () => proto.openAsset('BTC'));
  expect(proto.getContext().screen_revision).not.toBe(first);
});

it('manual review prepares a server preview and only a confirm tap changes the account', async () => {
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    if (String(url).endsWith('/preview')) return Response.json({ preview_id: 'pv-test', asset_id: 'gold', amount_thb: 1000, fee_thb: 5, qty: .0995 });
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
    ? { preview_id: 'pv', asset_id: 'gold', amount_thb: 1000 } : data));
  const error = vi.fn();
  const demo = installDemoData(proto, 'http://be', 'u_new', error, fetcher);
  await act(async () => { await demo.refresh(); proto.setState({ buyAmount: '1000' }); });
  await act(async () => proto.toReview());
  await act(async () => proto.setState({ buyAmount: '2000' }));
  await act(async () => proto.confirm());
  expect(error).toHaveBeenCalledWith('Review the amount again before confirming.');
  expect(fetcher.mock.calls.some(([u]) => String(u).endsWith('/confirm'))).toBe(false);
});
