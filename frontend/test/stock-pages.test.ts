// The new stocks and the Nasdaq 100 fund have their own asset pages, like Bitcoin, Ethereum and gold. The real design, patched
// for a backend, with a backend bundle for every asset.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDcApp } from '../src/dc-runtime';
import { setMascotFallback } from '../src/assets';
import { ids, installDemoData, type DemoBundle } from '../src/demo-data';
import { withJudgeCopy } from '../src/judge-copy';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const HTML = withJudgeCopy(readFileSync(path.join(__dirname, '../prototype/Icarus Prototype.dc.html'), 'utf8'), { liveData: true });
let root: Root, proto: any;
const chart = (id: string) => ({ period: '1m', display_version: `c-${id}`, source: { observed_at: '2026-10-01T00:00:00+00:00' },
  points: [{ at: '2026-09-01T00:00:00+00:00', price: '9000' }, { at: '2026-10-01T00:00:00+00:00', price: '10000' }] });
const bundle = (): DemoBundle => ({ mode: 'simulated', currency: 'THB', user_id: 'u_new', display_name: 'Test', cash_thb: 5000,
  holdings: Object.fromEntries(Object.keys(ids).map(id => [id, 0])), fees: { trading_fee_pct: .25, min_fee_thb: 5, min_buy_thb: 100 }, transactions: [], notice: 'x',
  assets: Object.fromEntries(Object.keys(ids).map((id, i) => [id, { price_thb: 1000 + i * 100, freshness: 'live', as_of: new Date().toISOString(), charts: { '1D': chart(id), '1M': chart(id) } }])) });

beforeEach(async () => {
  document.head.innerHTML = '';
  document.body.innerHTML = '<div id="root"></div>';
  setMascotFallback(true);
  const app = createDcApp(HTML);
  root = createRoot(document.getElementById('root')!);
  await act(async () => root.render(React.createElement(app.Root, { instanceRef: (p: unknown) => { if (p) proto = p; } })));
  const demo = installDemoData(proto, 'http://be', 'u_new', vi.fn(), vi.fn(async () => Response.json(bundle())));
  await act(async () => demo.refresh());
});
afterEach(async () => { await act(async () => root.unmount()); delete (window as any).Icarus; setMascotFallback(false); });

it('lists every asset with gold last, and the Stocks tab has the stocks', async () => {
  const all = proto.renderVals().assetRows.map((a: any) => a.id);
  expect(all).toEqual(['BTC', 'ETH', 'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'BRK', 'TSLA', 'QQQ', 'XAU']);
  await act(async () => proto.setState({ filter: 'Stocks' }));
  expect(proto.renderVals().assetRows.map((a: any) => a.id)).toEqual(all.slice(2, 11));
  await act(async () => proto.setState({ filter: 'Crypto' }));
  expect(proto.renderVals().assetRows.map((a: any) => a.id)).toEqual(['BTC', 'ETH']);
});

it.each(['NVDA', 'MSFT', 'QQQ', 'BRK'])('%s has its own page with the backend price and a buy screen', async (id) => {
  await act(async () => proto.openAsset(id));
  const view = proto.renderVals();
  expect(view.asset.price).toBe(`฿${(1000 + Object.keys(ids).indexOf(id) * 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  expect(view.asset.name).not.toBe('Gold');
  expect(proto.getContext().asset.id).toBe(id);
  expect(proto.calc(id, 1000, 'thb')).toMatchObject({ ok: true, total: 1000, fee: 5 });
});
