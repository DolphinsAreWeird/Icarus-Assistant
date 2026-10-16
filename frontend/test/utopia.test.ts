// "Ask U-topia" answers and handoffs to U-Bot, running inside Oasis's REAL prototype (in a simulated browser).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setMascotFallback } from '../src/assets';
import { createDcApp, installHelmet } from '../src/dc-runtime';
import { hideHandoffCard, showHandoffCard } from '../src/handoff-card';
import { installUtopiaRouting, scenarioOf, type PrototypeInstance } from '../src/utopia-bridge';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HTML = readFileSync(path.join(__dirname, '../prototype/Icarus Prototype.dc.html'), 'utf8');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Route = Record<string, unknown>;
const HANDOFF = (reason: string, question: string, message: string): Route => ({
  kind: 'handoff', language: 'en', handoff: { target: 'u-bot', reason, label: 'Open U-Bot', message, url: 'https://u.bot/', question },
});

/** Stands in for the voice server. Behaves like the real /api/utopia/route for the requests these tests use. */
function makeFetch(decide: (body: { text: string; language: string; fallback?: boolean }) => Route | 'down') {
  const calls: Array<{ text: string; language: string; fallback?: boolean }> = [];
  const fn = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body));
    calls.push(body);
    const out = decide(body);
    if (out === 'down') throw new Error('connect ECONNREFUSED');
    return { ok: true, json: async () => out } as Response;
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const standard = (body: { text: string; fallback?: boolean }): Route => {
  const t = body.text.toLowerCase();
  if (t.includes('u-coin')) return { kind: 'answer', answer: 'U-Coin is the native token of the U-topia ecosystem.', source: 'mock', verified: false, topic: 'u-coin', language: 'en' };
  if (t.includes('ยูคอยน์')) return { kind: 'answer', answer: 'ยูคอยน์คือโทเคนประจำระบบนิเวศของยูโทเปีย', source: 'mock', verified: false, topic: 'u-coin', language: 'th' };
  if (t.includes('flight')) return HANDOFF('commerce', body.text, "That's outside what I can do in this app. U-Bot can help with travel, rides and grocery orders, and you review and pay in U-topia Pay.");
  if (body.fallback && t.includes('train times')) return HANDOFF('general', body.text, "I can't help with that here. U-Bot is a general assistant, so it may be able to.");
  return { kind: 'none' };
};

let root: Root;
let instance: (PrototypeInstance & { goBack?: () => void }) | null;
const icarus = () => (window as unknown as { Icarus: { send: (t: string) => void } }).Icarus;
const card = () => document.getElementById('icarus-handoff');

async function mount() {
  document.head.innerHTML = '';
  document.body.innerHTML = '<div id="root"></div>';
  setMascotFallback(true);
  instance = null;
  const app = createDcApp(HTML);
  installHelmet(app.helmet);
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => {
    root.render(React.createElement(app.Root, { instanceRef: (c: unknown) => (instance = c as typeof instance) }));
  });
}

function install(fetchImpl: typeof fetch) {
  return installUtopiaRouting({
    getInstance: () => instance,
    fetchImpl,
    cardDelayMs: 10,
    showCard: (h, th) => showHandoffCard(h, { th, getPhone: () => document.querySelector('[data-screen-label="Phone"]') }),
    hideCard: hideHandoffCard,
  });
}

/** Type a message into the prototype's chat and wait for its answer to appear. */
async function ask(text: string) {
  await act(async () => icarus().send(text));
  await sleep(1000);
}

beforeEach(async () => {
  localStorage.clear();
  await mount();
});
afterEach(async () => {
  hideHandoffCard();
  await act(async () => root.unmount());
  delete (window as { Icarus?: unknown }).Icarus;
  setMascotFallback(false);
});

describe('Ask U-topia, inside the real prototype', () => {
  it('answers "What is U-Coin?" in the chat, and says the answer is a mock', async () => {
    const f = makeFetch(standard);
    expect(install(f.fn)).toBe(true);
    await ask('What is U-Coin?');
    const text = document.body.textContent ?? '';
    expect(text).toContain('U-Coin is the native token of the U-topia ecosystem.');
    expect(text).toContain('Mock answer, not checked by U-topia yet');
    expect(card()).toBeNull(); // an answer needs no handoff
    // where the user is goes along, for the prompt Icarus writes for U-Bot (the prototype starts on Home)
    expect(f.calls[0]).toEqual({ text: 'What is U-Coin?', language: 'en', context: { screen: 'Home screen' } });
  });

  it('answers in Thai when the question is Thai', async () => {
    const f = makeFetch(standard);
    install(f.fn);
    await ask('ยูคอยน์คืออะไร');
    expect(document.body.textContent).toContain('ยูคอยน์คือโทเคนประจำระบบนิเวศของยูโทเปีย');
    expect(f.calls[0]?.language).toBe('th');
  });
});

describe('a finance question the app has no data for, inside the real prototype', () => {
  it('says plainly what Icarus can do instead of a dead end or a U-Bot handoff, and never a number', async () => {
    const f = makeFetch(standard);
    install(f.fn);
    await ask('how is the S&P 500 doing today?');
    const text = document.body.textContent ?? '';
    expect(text).toContain("I don't have data for that in this app, so I won't guess a number.");
    expect(card()).toBeNull();
    expect(f.calls.some((c) => c.fallback)).toBe(false); // not sent to U-Bot
  });
});

describe('handoff to U-Bot, inside the real prototype', () => {
  it('says it cannot do it, shows the card with a real link, and logs a friction event', async () => {
    install(makeFetch(standard).fn);
    await ask('book me a flight to Phuket');
    expect(document.body.textContent).toContain('U-Bot can help with travel, rides and grocery orders');

    const c = card();
    expect(c, 'the handoff card').toBeTruthy();
    const link = c?.querySelector('a') as HTMLAnchorElement;
    expect(link.href).toBe('https://u.bot/');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(link.textContent).toBe('Open U-Bot');
    expect(c?.textContent).toContain('book me a flight to Phuket'); // the user's own words, to paste into U-Bot
    expect(c?.textContent).toContain('You need to sign in there');

    // The business dashboard's event log gets a handoff event, so "what Icarus could not do" is visible as friction.
    const stored = Object.values(localStorage).join('');
    expect(stored).toContain('"type":"handoff"');
    expect(stored).toContain('"reason":"commerce"');
  });

  it('leaves normal in-app requests exactly as they were: no handoff, the prototype answers', async () => {
    const f = makeFetch(standard);
    install(f.fn);
    await ask('show me gold');
    expect(card()).toBeNull();
    expect(document.body.textContent).toMatch(/Gold/);
    expect(document.body.textContent).not.toContain('U-Bot');
    expect(f.calls).toHaveLength(1); // one check, no fallback
  });

  it('offers U-Bot instead of "I didn\'t catch that" for a real request the prototype cannot handle', async () => {
    const f = makeFetch(standard);
    install(f.fn);
    await ask('can you check the train times to Hua Hin');
    expect(f.calls).toEqual([
      { text: 'can you check the train times to Hua Hin', language: 'en', context: { screen: 'Home screen' } },
      { text: 'can you check the train times to Hua Hin', language: 'en', fallback: true, context: { screen: 'Home screen' } },
    ]);
    expect(document.body.textContent).toContain('U-Bot is a general assistant');
    expect(card()).toBeTruthy();
  });

  it('keeps "I didn\'t catch that" for a misheard word', async () => {
    install(makeFetch(standard).fn);
    await ask('uh gold gold');
    expect(card()).toBeNull();
  });

  it('does nothing different when the voice server is down', async () => {
    install(makeFetch(() => 'down').fn);
    await ask('show me gold');
    expect(card()).toBeNull();
    expect(document.body.textContent).toMatch(/Gold/);
  });

  it('removes the old card when the next request comes in', async () => {
    install(makeFetch(standard).fn);
    await ask('book me a flight to Phuket');
    expect(card()).toBeTruthy();
    await act(async () => icarus().send('show me gold'));
    expect(card()).toBeNull(); // gone as soon as the next request starts
    await sleep(900);
  });

  it('wording is Thai when the user speaks Thai', async () => {
    install(makeFetch((b) => (b.text.includes('เที่ยวบิน') ? HANDOFF('commerce', b.text, 'เรื่องนี้เกินกว่าที่ฉันทำได้ในแอปนี้') : { kind: 'none' })).fn);
    await ask('ช่วยหาเที่ยวบินไปเชียงใหม่ให้หน่อย');
    expect(card()?.textContent).toContain('U-Bot ช่วยเรื่องนี้ได้');
  });

  it('installs once, and says no when there is nothing to attach to', () => {
    const f = makeFetch(standard);
    expect(install(f.fn)).toBe(true);
    const wrapped = instance?.demoRespond;
    expect(install(f.fn)).toBe(true);
    expect(instance?.demoRespond).toBe(wrapped); // not wrapped twice
    expect(installUtopiaRouting({ getInstance: () => null, showCard: () => undefined, hideCard: () => undefined })).toBe(false);
  });
});

describe('the handoff card on its own', () => {
  const info = { label: 'Open U-Bot', message: 'm', url: 'https://u.bot/', question: 'order me groceries', reason: 'commerce' };

  it('copies the question for pasting into U-Bot', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const c = showHandoffCard(info, { th: false, getPhone: () => null });
    const copy = [...c.querySelectorAll('button')].find((b) => b.textContent === 'Copy my question') as HTMLButtonElement;
    await act(async () => copy.click());
    expect(writeText).toHaveBeenCalledWith('order me groceries');
    expect(copy.textContent).toBe('Copied');
  });

  it('shows the words instead if the clipboard is blocked', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied'); } }, configurable: true });
    const c = showHandoffCard(info, { th: false, getPhone: () => null });
    const copy = c.querySelectorAll('button')[0] as HTMLButtonElement;
    await act(async () => copy.click());
    expect(copy.textContent).toBe('order me groceries');
  });

  it('dismisses, and only ever shows one card', () => {
    showHandoffCard(info, { th: false, getPhone: () => null });
    showHandoffCard({ ...info, question: 'second' }, { th: false, getPhone: () => null });
    expect(document.querySelectorAll('#icarus-handoff')).toHaveLength(1);
    expect(card()?.textContent).toContain('second');
    (card()?.querySelectorAll('button')[1] as HTMLButtonElement).click(); // Not now
    expect(card()).toBeNull();
  });

  it('sits over the phone when there is one', () => {
    const phone = document.createElement('div');
    phone.getBoundingClientRect = () => ({ left: 100, right: 493, top: 20, bottom: 872, width: 393, height: 852, x: 100, y: 20, toJSON: () => ({}) }) as DOMRect;
    const c = showHandoffCard(info, { th: false, getPhone: () => phone });
    expect(c.style.left).toBe('116px');
    expect(c.style.width).toBe('361px');
  });
});

describe('the prompt Icarus writes for the real U-Bot', () => {
  it('describes where the user is in words, and nothing personal', () => {
    expect(scenarioOf({ screen: 'asset', asset: { id: 'XAU', name: 'Gold', price_usd: 2358.7 }, portfolio: { value_usd: 28399 } }, false)).toEqual({ screen: 'Gold page', asset: 'Gold' });
    expect(scenarioOf({ screen: 'buy', asset: { name: 'Bitcoin' } }, false)).toEqual({ screen: 'buy screen for Bitcoin', asset: 'Bitcoin' });
    expect(scenarioOf({ screen: 'card', asset: { name: 'Gold' } }, false)).toEqual({ screen: 'Card screen' });
    expect(scenarioOf({ screen: 'home' }, true)).toEqual({ screen: 'หน้าหลัก' });
    expect(scenarioOf(undefined, false)).toEqual({});
  });

  it('the card shows the prompt, and one tap copies it and opens the real U-Bot', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const prompt = 'Book me a ride to the airport. Show me a few options with the price and pickup time, then let me review and pay in U-topia Pay.\nMy request: “book me a ride to the airport”';
    const c = showHandoffCard({ label: 'Open U-Bot', message: 'm', url: 'https://u.bot/', question: 'book me a ride to the airport', reason: 'commerce', prompt }, { th: false, getPhone: () => null });
    expect(c.querySelector('[data-testid="ubot-prompt"]')?.textContent).toBe(prompt);
    const link = c.querySelector('a') as HTMLAnchorElement;
    expect(link.textContent).toBe('Copy and open U-Bot');
    expect(link.href).toBe('https://u.bot/');
    expect(link.target).toBe('_blank');
    link.addEventListener('click', (e) => e.preventDefault()); // jsdom cannot open a tab
    link.click();
    await sleep(0);
    expect(writeText).toHaveBeenCalledWith(prompt);
    expect(c.textContent).toContain('Copied. Paste it in the U-Bot chat.');
    expect(c.textContent).not.toContain('Copy my question');
  });
});
