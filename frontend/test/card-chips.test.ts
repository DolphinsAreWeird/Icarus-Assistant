// A closed chart or steps card comes back with a chip under Icarus's message. The real prototype, the real cards.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installBackend } from '../src/backend-bridge';
import { CHIP_TEXT, createCardChips } from '../src/card-chips';
import { hideInfoCard, showChartCard, showStepsCard, type ChartCardData, type StepsCardData } from '../src/chat-cards';
import { createDcApp, installHelmet } from '../src/dc-runtime';
import { setMascotFallback } from '../src/assets';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const HTML = readFileSync(path.join(__dirname, '../prototype/Icarus Prototype.dc.html'), 'utf8');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const STEPS = { title: 'How to buy', topic: 'buy', steps: [
  { n: 1, title: 'Open the asset', text: 'Go to Invest.', show_me: [] },
  { n: 2, title: 'Tap Buy', text: 'At the bottom.', show_me: [{ type: 'open_asset', asset: 'XAU' }] }] };
const CHART = { title: 'Gold vs Bitcoin', period: '1Y', unit: '%', source: 'Binance price history', series: [
  { asset_id: 'XAU', name: 'Gold', change_text: 'up 0.3%', points: [['2025-10-15T00:00:00+00:00', 0], ['2026-10-14T00:00:00+00:00', 0.3]] },
  { asset_id: 'BTC', name: 'Bitcoin', change_text: 'down 24%', points: [['2025-10-15T00:00:00+00:00', 0], ['2026-10-14T00:00:00+00:00', -24]] }] };

type Proto = Record<string, any>;
let root: Root;
let proto: Proto;
const card = () => document.getElementById('icarus-info-card');
const phone = () => document.querySelector('[data-screen-label="Phone"]') as Element;

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
  hideInfoCard();
  await act(async () => root.unmount());
  delete (window as { Icarus?: unknown }).Icarus;
  setMascotFallback(false);
});

const showers = () => ({
  chart: vi.fn((d: Record<string, unknown>, lang: 'en' | 'th') => showChartCard(d as unknown as ChartCardData, { lang, getPhone: phone })),
  steps: vi.fn((d: Record<string, unknown>, lang: 'en' | 'th') => showStepsCard(d as unknown as StepsCardData, { lang, getPhone: phone, runActions: () => undefined })),
});

describe('the chip registry', () => {
  it('gives every card its own chip text, in both languages, even for two cards of the same kind', () => {
    const chips = createCardChips(showers());
    const a = chips.register('steps', STEPS, 'en');
    const b = chips.register('steps', STEPS, 'en');
    expect(a.trim().replace(/​/g, '')).toBe(CHIP_TEXT.steps.en);
    expect(b.replace(/​/g, '')).toBe(CHIP_TEXT.steps.en);
    expect(a).not.toBe(b);                                                   // different cards, different chips
    expect(chips.register('chart', CHART, 'th').replace(/​/g, '')).toBe('ดูกราฟอีกครั้ง');
  });

  it('tapping a chip shows its card and sends nothing to Icarus; any other text goes through as before', async () => {
    const show = showers();
    const chips = createCardChips(show);
    const ask = vi.fn(async () => ({ text: 'hi', speech: 'hi', emotion: 'happy', speak: false, ui_actions: [], sources: [], suggestions: [], offer: null }));
    (window as unknown as { Icarus: { setBackend: (fn: unknown) => void } }).Icarus.setBackend(ask);
    chips.install(proto);
    const chip = chips.register('steps', STEPS, 'en');
    const before = proto.state.messages.length;
    await act(async () => { proto.send(chip); });
    expect(show.steps).toHaveBeenCalledWith(STEPS, 'en');
    expect(card()?.textContent).toContain('How to buy');
    expect(proto.state.messages.length).toBe(before);                          // no user bubble, no new message
    expect(ask).not.toHaveBeenCalled();                                        // and no backend call
    expect(JSON.parse(localStorage.getItem('icarus.demo.events') ?? '[]').some((e: { type: string }) => e.type === 'card_reopened')).toBe(true);
    await act(async () => { proto.send('what is a stablecoin'); });
    await act(async () => { await sleep(900); });
    expect(ask).toHaveBeenCalledTimes(1);                                       // a normal question still goes to Icarus
    expect(proto.state.messages.at(-1).role).toBe('icarus');
  });

  it('installing twice does not stack wrappers, and a card that cannot draw never breaks the chat', async () => {
    const boom = { chart: vi.fn(() => { throw new Error('bad card'); }), steps: vi.fn() };
    const chips = createCardChips(boom);
    chips.install(proto);
    const send = proto.send;
    chips.install(proto);
    expect(proto.send).toBe(send);
    const chip = chips.register('chart', CHART, 'en');
    await act(async () => { expect(() => proto.send(chip)).not.toThrow(); });
    expect(boom.chart).toHaveBeenCalledTimes(1);
  });
});

describe('end to end: close the card, then bring it back from the chat', () => {
  function connect(body: Record<string, unknown>) {
    const show = showers();
    const chips = createCardChips(show);
    chips.install(proto);
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }) as Response) as unknown as typeof fetch;
    expect(installBackend({ url: 'http://be', userId: 'u', getInstance: () => proto as never, showTrade: vi.fn(), hideCards: hideInfoCard,
      showChart: show.chart, showSteps: show.steps, cardChip: chips.register, fetchImpl, cardDelayMs: 0 })).toBe(true);
    return show;
  }
  const ask = async (text: string) => { await act(async () => { proto.send(text); }); await act(async () => { await sleep(80); }); };
  const chipInChat = (label: string) => [...document.querySelectorAll<HTMLElement>('div')].find((d) => d.textContent?.replace(/​/g, '') === label && d.style.cursor === 'pointer');

  it('steps: a chip appears under the reply, and tapping it shows the card again after it was closed', async () => {
    const show = connect({ text: 'Here are the steps. Use Show me to find each button.', ui_actions: [{ type: 'card', card_type: 'steps', data: STEPS }], sources: [] });
    await ask('How do I buy?');
    expect(card()?.textContent).toContain('How to buy');                       // the card opens by itself, as before
    expect(proto.state.messages.at(-1).suggestions[0].replace(/​/g, '')).toBe('Show the steps again');
    hideInfoCard();                                                            // the user presses Close
    expect(card()).toBeNull();
    const chip = chipInChat('Show the steps again');
    expect(chip, 'the chip is in the chat under the reply').toBeTruthy();
    await act(async () => { chip!.click(); });
    expect(show.steps).toHaveBeenCalledTimes(2);                               // shown once automatically, once from the chip
    expect(card()?.textContent).toContain('Tap Buy');
  });

  it('charts too, and each reply keeps its own card', async () => {
    connect({ text: 'Gold is up a little; Bitcoin is down.', ui_actions: [{ type: 'card', card_type: 'chart', data: CHART }], sources: [] });
    await ask('compare gold to btc');
    hideInfoCard();
    await act(async () => { chipInChat('Show the chart again')!.click(); });
    expect(card()?.textContent).toContain('Gold vs Bitcoin');
  });

  it('no chip when there is no card, and no chip beside a trade card', async () => {
    connect({ text: 'Gold is a metal.', ui_actions: [], sources: [], suggestions: ['Show me gold'] });
    await ask('what is gold');
    expect(proto.state.messages.at(-1).suggestions).toEqual(['Show me gold']);
  });
});
