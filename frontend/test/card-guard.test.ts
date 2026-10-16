// A frozen card blocks buying, in the real prototype, on the paths a user can take.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installCardGuard, FROZEN_MESSAGE } from '../src/card-guard';
import { createDcApp, installHelmet } from '../src/dc-runtime';
import { setMascotFallback } from '../src/assets';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const HTML = readFileSync(path.join(__dirname, '../prototype/Icarus Prototype.dc.html'), 'utf8');

type Proto = {
  state: Record<string, unknown>;
  setState: (s: Record<string, unknown>) => void;
  calc: (id: string, amt: number, wallet: string) => { ok: boolean; err: string };
  getContext: () => Record<string, unknown>;
  toReview: () => void;
  confirm: () => void;
};
let root: Root;
let proto: Proto;

beforeEach(async () => {
  document.head.innerHTML = '';
  document.body.innerHTML = '<div id="root"></div>';
  setMascotFallback(true);
  const app = createDcApp(HTML);
  installHelmet(app.helmet);
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => {
    root.render(React.createElement(app.Root, { instanceRef: (c: unknown) => { if (c) proto = c as Proto; } }));
  });
  installCardGuard(proto);
});

afterEach(async () => {
  await act(async () => root.unmount());
  delete (window as { Icarus?: unknown }).Icarus;
  setMascotFallback(false);
});

describe('a frozen card blocks buying', () => {
  it('lets a normal purchase through, and tells Icarus the card is not frozen', () => {
    expect(proto.calc('XAU', 1000, 'thb').ok).toBe(true);
    expect(proto.getContext().card_frozen).toBe(false);
  });

  it('refuses the purchase with a clear message once the card is frozen, and again after unfreezing', async () => {
    await act(async () => proto.setState({ frozen: true }));
    const c = proto.calc('XAU', 1000, 'thb');
    expect(c.ok).toBe(false);
    expect(c.err).toBe(FROZEN_MESSAGE.en);
    expect(proto.getContext().card_frozen).toBe(true);
    await act(async () => proto.setState({ lang: 'th' }));
    expect(proto.calc('XAU', 1000, 'thb').err).toBe(FROZEN_MESSAGE.th);
    await act(async () => proto.setState({ frozen: false, lang: 'en' }));
    expect(proto.calc('XAU', 1000, 'thb').ok).toBe(true);
  });

  it('does not move to Review, and Confirm purchase buys nothing', async () => {
    await act(async () => proto.setState({ tab: 'invest', view: 'buy', assetId: 'XAU', buyStep: 'amount', buyAmount: '1000', frozen: true }));
    await act(async () => proto.toReview());
    expect(proto.state.buyStep).toBe('amount');
    const cash = proto.state.thbBal;
    await act(async () => proto.setState({ buyStep: 'review' })); // Icarus's `review` action goes straight to the screen
    await act(async () => proto.confirm());
    expect(proto.state.buyStep).toBe('review');
    expect(proto.state.thbBal).toBe(cash);
    expect(document.body.textContent).toContain(FROZEN_MESSAGE.en);
  });
});
