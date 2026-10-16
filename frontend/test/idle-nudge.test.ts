// Icarus speaks up when the user is stuck: the real prototype, a short idle time, and a fake backend.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installCardGuard } from '../src/card-guard';
import { createDcApp, installHelmet } from '../src/dc-runtime';
import { backendNudge, installIdleNudge, type IdleNudgeOptions, type NudgeReply } from '../src/idle-nudge';
import { setMascotFallback } from '../src/assets';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const HTML = readFileSync(path.join(__dirname, '../prototype/Icarus Prototype.dc.html'), 'utf8');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const IDLE = 80;

type Proto = {
  state: Record<string, any>;
  setState: (s: Record<string, unknown>) => void;
  getContext: () => Record<string, any>;
};
const MIN_NUDGE: NudgeReply = { reason: 'below_minimum', text: 'The minimum is 100 baht. Try a bigger amount.', highlight: 'buy.amount_input', suggestions: ['How do I buy?'] };

let root: Root;
let proto: Proto;
let stop: () => void;
type Ask = IdleNudgeOptions['fetchNudge'];
let fetchNudge: ReturnType<typeof vi.fn<Ask>>;
let spoken: ReturnType<typeof vi.fn>;

const phone = () => document.querySelector('[data-screen-label="Phone"]') as Element;
const events = () => JSON.parse(localStorage.getItem('icarus.demo.events') ?? '[]') as Array<{ type: string; reason?: string }>;
/** Put the user on the Buy amount screen for gold with this amount typed. */
const onBuyScreen = (amount = '50') => act(async () => proto.setState({ tab: 'invest', view: 'buy', assetId: 'XAU', buyStep: 'amount', buyAmount: amount }));

async function start(reply: NudgeReply | null | Error = MIN_NUDGE, extra: { maxPerSession?: number } = {}) {
  fetchNudge = vi.fn<Ask>(async () => { if (reply instanceof Error) throw reply; return reply; });
  stop = installIdleNudge(proto, { fetchNudge, getPhone: phone, idleMs: IDLE, checkMs: 10, ...extra });
}

beforeEach(async () => {
  localStorage.clear();
  document.head.innerHTML = '';
  document.body.innerHTML = '<div id="root"></div>';
  setMascotFallback(true);
  spoken = vi.fn();
  const app = createDcApp(HTML);
  installHelmet(app.helmet);
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => {
    root.render(React.createElement(app.Root, { instanceRef: (c: unknown) => { if (c) proto = c as Proto; } }));
  });
  (window as unknown as { Icarus: Record<string, unknown> }).Icarus._tts = spoken; // anything spoken would land here
  installCardGuard(proto as never);
});

afterEach(async () => {
  stop?.();
  await act(async () => root.unmount());
  delete (window as { Icarus?: unknown }).Icarus;
  setMascotFallback(false);
});

describe('Icarus speaks up when the user is stuck', () => {
  it('after the idle time on the Buy screen: a bubble, a chat line with its chip, a highlight, a log, and no sound', async () => {
    await start();
    await onBuyScreen();
    await act(async () => { await sleep(IDLE * 3); });
    expect(fetchNudge).toHaveBeenCalledTimes(1);
    const [context, idleSeconds] = fetchNudge.mock.calls[0]!;
    expect(context.screen).toBe('buy');
    expect(context.card_frozen).toBe(false);       // the backend gets the card state
    expect(idleSeconds).toBeGreaterThanOrEqual(0);
    expect(proto.state.fabBubble).toBe(MIN_NUDGE.text);
    expect(proto.state.flash).toBe('buy.amount_input');
    const last = proto.state.messages.at(-1);
    expect(last).toMatchObject({ role: 'icarus', text: MIN_NUDGE.text, suggestions: ['How do I buy?'] });
    expect(events().find((e) => e.type === 'nudge_shown')?.reason).toBe('below_minimum');
    expect(spoken).not.toHaveBeenCalled();         // silent
  });

  it('waits while the user is active, then speaks up once they stop', async () => {
    await start();
    await onBuyScreen();
    const until = Date.now() + IDLE * 3;
    while (Date.now() < until) {
      phone().dispatchEvent(new Event('pointerdown', { bubbles: true }));
      await act(async () => { await sleep(IDLE / 4); });
    }
    expect(fetchNudge).not.toHaveBeenCalled();
    await act(async () => { await sleep(IDLE * 3); });
    expect(fetchNudge).toHaveBeenCalledTimes(1);
  });

  it('restarts the countdown when something on screen changes (typing an amount)', async () => {
    await start();
    await onBuyScreen('5');
    for (const amount of ['50', '500', '5000']) {
      await act(async () => { await sleep(IDLE / 2); });
      await onBuyScreen(amount);
    }
    expect(fetchNudge).not.toHaveBeenCalled();
  });

  it.each([
    ['the chat is open', { asst: 'open' }],
    ['voice mode is on', { asst: 'voice', voice: { phase: 'listening' } }],
    ['a guide is running', { guide: { asset: 'XAU', i: 1 } }],
    ['a scenario stopwatch is running', { timer: { mode: 'B', start: Date.now() } }],
  ])('stays quiet while %s', async (_name, patch) => {
    await start();
    await onBuyScreen();
    await act(async () => proto.setState(patch));
    await act(async () => { await sleep(IDLE * 3); });
    expect(fetchNudge).not.toHaveBeenCalled();
    expect(proto.state.fabBubble).toBeFalsy();
  });

  it('asks once per screen state, and never repeats the same reason on the same screen', async () => {
    await start();
    await onBuyScreen('50');
    await act(async () => { await sleep(IDLE * 4); });
    expect(fetchNudge).toHaveBeenCalledTimes(1);          // idle for much longer: still one question
    await act(async () => proto.setState({ fabBubble: null }));
    await onBuyScreen('60');                              // a new state, but the same reason on the same screen
    await act(async () => { await sleep(IDLE * 3); });
    expect(fetchNudge).toHaveBeenCalledTimes(2);          // it asks again...
    expect(proto.state.messages.filter((m: { text: string }) => m.text === MIN_NUDGE.text)).toHaveLength(1); // ...but shows nothing new
  });

  it('shows nothing, and no error, when the backend has nothing to say or fails', async () => {
    for (const reply of [null, new Error('backend down')]) {
      await start(reply);
      await onBuyScreen();
      await act(async () => { await sleep(IDLE * 3); });
      expect(fetchNudge).toHaveBeenCalledTimes(1);
      expect(proto.state.fabBubble).toBeFalsy();
      expect(events().some((e) => e.type === 'nudge_shown')).toBe(false);
      stop();
      await act(async () => proto.setState({ tab: 'home', view: 'invest', buyAmount: '' }));
    }
  });

  it('shows at most maxPerSession nudges', async () => {
    await start(MIN_NUDGE, { maxPerSession: 1 });
    await onBuyScreen();
    await act(async () => { await sleep(IDLE * 3); });
    await act(async () => proto.setState({ fabBubble: null, tab: 'payments', view: 'invest' }));
    fetchNudge.mockImplementation(async () => ({ ...MIN_NUDGE, reason: 'payments_dead_end' }));
    await act(async () => { await sleep(IDLE * 3); });
    expect(proto.state.messages.filter((m: { sources?: string[] }) => m.sources?.includes('nudge · rules'))).toHaveLength(1);
  });

  it('drops the answer if the user acted while it was on its way', async () => {
    let release: (n: NudgeReply | null) => void = () => undefined;
    fetchNudge = vi.fn<Ask>(() => new Promise<NudgeReply | null>((r) => { release = r; }));
    stop = installIdleNudge(proto, { fetchNudge, getPhone: phone, idleMs: IDLE, checkMs: 10 });
    await onBuyScreen('50');
    await act(async () => { await sleep(IDLE * 3); });
    await onBuyScreen('5000');                            // the user typed while the backend was thinking
    await act(async () => release(MIN_NUDGE));
    await act(async () => { await sleep(IDLE); });
    expect(proto.state.fabBubble).toBeFalsy();
  });

  it('stops when uninstalled', async () => {
    await start();
    stop();
    await onBuyScreen();
    await act(async () => { await sleep(IDLE * 3); });
    expect(fetchNudge).not.toHaveBeenCalled();
  });
});

describe('asking the backend', () => {
  it('posts the screen to /nudge and returns its answer, or null on any problem', async () => {
    const ok = vi.fn(async () => ({ ok: true, json: async () => ({ nudge: MIN_NUDGE }) }) as Response) as unknown as typeof fetch;
    const nudge = await backendNudge('http://be', 'u_new', ok)({ language: 'th', screen: 'buy', card_frozen: true }, 15);
    expect(nudge).toEqual(MIN_NUDGE);
    const [url, init] = (ok as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls[0]!;
    expect(url).toBe('http://be/nudge');
    expect(JSON.parse(init.body)).toEqual({ user_id: 'u_new', lang: 'th', snapshot: { language: 'th', screen: 'buy', card_frozen: true }, idle_s: 15 });
    const bad = vi.fn(async () => ({ ok: false, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    expect(await backendNudge('http://be', 'u_new', bad)({}, 1)).toBeNull();
    const none = vi.fn(async () => ({ ok: true, json: async () => ({ nudge: null }) }) as Response) as unknown as typeof fetch;
    expect(await backendNudge('http://be', 'u_new', none)({}, 1)).toBeNull();
  });
});
