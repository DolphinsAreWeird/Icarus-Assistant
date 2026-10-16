import { readFileSync } from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDcApp } from '../src/dc-runtime';
import { setMascotFallback } from '../src/assets';
import { buyOnAppScreens, toPrototypeReply } from '../src/backend-bridge';
import { installDemoData, type DemoBundle } from '../src/demo-data';
import { spokenExactNumber } from '../../voice/src/shared/speech-format';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const html = readFileSync(path.join(__dirname, '../prototype/Icarus Prototype.dc.html'), 'utf8');
let root: Root, proto: any;
const money = (n: number) => `฿${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

beforeEach(async () => {
  document.body.innerHTML = '<div id="root"></div>';
  setMascotFallback(true);
  root = createRoot(document.getElementById('root')!);
  const app = createDcApp(html);
  await act(async () => root.render(React.createElement(app.Root, { instanceRef: (p: unknown) => { proto = p; } })));
  vi.useFakeTimers();
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
  delete (window as any).Icarus;
  setMascotFallback(false);
});

it.each([100, 100.01, 1000, 1000.49, 1000.50, 47772.28])('standalone purchase keeps %s through speech, animation, review and tap', async amount => {
  const reply = proto.demoRespond(`Put ${amount} baht in gold`, proto.getContext());
  const expected = amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
  expect(reply.speech).toContain(`${expected} baht`);
  const thai = proto.rBuy('XAU', amount, 'thb', true, proto.getContext());
  expect(thai.speech).toContain(`${expected} บาท`);
  await act(async () => proto.runActions(reply.ui_actions));
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(proto.state.buyAmount).toBe(String(amount));
  expect(proto.state.buyStep).toBe('review');
  expect(proto.renderVals().buy.amt).toBe(money(amount));
  expect(document.body.textContent).toContain(money(amount));
  expect(proto.state.thbBal).toBe(48250); // Animation never approves the purchase.
  const total = proto.calc('XAU', amount, 'thb').total;
  await act(async () => document.querySelector<HTMLElement>('[data-ui-id="buy.confirm_button"]')!.click());
  expect(proto.state.lastBuy.amt).toBe(amount);
  expect(proto.state.thbBal).toBeCloseTo(48250 - total, 8);
});

it.each([99.99, 47772.29])('standalone rejects %s at the minimum/balance boundary without rounding it into range', amount => {
  const reply = proto.demoRespond(`Put ${amount} baht in gold`, proto.getContext());
  expect(reply.ui_actions).toEqual([]);
  expect(proto.state.thbBal).toBe(48250);
});

it.each([100, 100.01, 1000, 1000.49, 1000.50, 4999.99, 5000])('backend budget %s survives the real animated input and exact fake-server debit', async amount => {
  const data: DemoBundle = {
    mode: 'simulated', currency: 'THB', user_id: 'u_new', display_name: 'Test', cash_thb: 5000,
    holdings: { XAU: 0 }, transactions: [], notice: 'Simulated',
    fees: { trading_fee_pct: .25, min_fee_thb: 5, min_buy_thb: 100 },
    assets: { XAU: { price_thb: 10000, freshness: 'offline', charts: {} } },
  };
  const fee = Math.max(Math.round(amount * .25) / 100, 5);
  const preview = { preview_id: 'pv-decimal', side: 'buy', asset_id: 'gold', amount_thb: amount, fee_thb: fee, qty: Math.round((amount - fee) / 10000 * 1e8) / 1e8 };
  let confirmed = false;
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/preview')) {
      expect(JSON.parse(String(init?.body)).amount_thb).toBe(amount);
      return Response.json(preview);
    }
    if (String(url).endsWith('/confirm')) { confirmed = true; return Response.json({ status: 'confirmed' }); }
    return Response.json(confirmed ? { ...data, cash_thb: 5000 - amount, holdings: { XAU: preview.qty } } : data);
  });
  const error = vi.fn();
  const demo = installDemoData(proto, 'http://fake', 'u_new', error, fetcher);
  await act(async () => demo.refresh());
  const reply = toPrototypeReply({ text: 'Review purchase', ui_actions: [{ type: 'card', card_type: 'trade_preview', data: preview }] }, 'en', proto.getContext(), proto).reply;
  expect(reply.speech).toContain(`${spokenExactNumber(amount, 'en')} baht`);
  const spoken = vi.fn(async (_text: string) => undefined);
  (window as any).Icarus.setTTS(spoken, () => undefined);
  await act(async () => { proto.speak(reply.speech); proto.runActions(reply.ui_actions); });
  await act(async () => vi.advanceTimersByTimeAsync(760));
  expect(proto.state.buyAmount).toBe(String(amount).slice(0, 1)); // Real 110ms character animation ran.
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(spoken.mock.calls[0]?.[0]).toBe(reply.speech);
  expect(proto.state.buyAmount).toBe(String(amount));
  expect(proto.renderVals().buy.total).toBe(money(amount));
  expect(document.body.textContent).toContain(money(amount));
  expect(confirmed).toBe(false);
  // Prepare via the native review boundary, then execute only the user's tap.
  await act(async () => proto.toReview());
  await act(async () => document.querySelector<HTMLElement>('[data-ui-id="buy.confirm_button"]')!.click());
  expect(confirmed).toBe(true);
  expect(proto.state.thbBal).toBeCloseTo(5000 - amount, 8);
  expect(proto.state.lastBuy.total).toBe(amount);
  expect(error).not.toHaveBeenCalled();
});

it.each([99.99, 47772.29])('animation preserves rejected boundary %s without enabling execution', async amount => {
  const actions = buyOnAppScreens({ side: 'buy', asset_id: 'gold', amount_thb: amount }, proto)!;
  await act(async () => proto.runActions(actions));
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(proto.state.buyAmount).toBe(String(amount));
  expect(proto.calc('XAU', amount, 'thb').ok).toBe(false);
  await act(async () => proto.confirm());
  expect(proto.state.lastBuy).toBeNull();
  expect(proto.state.thbBal).toBe(48250);
});
