import { readFileSync } from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDcApp, installHelmet } from '../src/dc-runtime';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HTML = readFileSync(path.join(__dirname, '../prototype/Icarus Business Dashboard.dc.html'), 'utf8');
const STORE = 'icarus.demo.events';
const ev = (i: number) => ({ t: 1000 + i, type: 'question', screen: 'home', text: `Question number ${i}` });
const write = (arr: unknown[]) => localStorage.setItem(STORE, JSON.stringify(arr.slice(-400)));

let root: Root;
let host: HTMLElement;

beforeEach(async () => {
  localStorage.clear();
  document.head.innerHTML = '';
  document.body.innerHTML = '<div id="root"></div>';
  host = document.getElementById('root') as HTMLElement;
});
afterEach(async () => {
  await act(async () => root.unmount());
  localStorage.clear();
});

async function mount() {
  const app = createDcApp(HTML);
  installHelmet(app.helmet);
  root = createRoot(host);
  await act(async () => { root.render(React.createElement(app.Root, {})); });
}

describe('business dashboard live panel', () => {
  it('refreshes when the 400-event ring rolls over and the count stays 400', async () => {
    const all = Array.from({ length: 400 }, (_, i) => ev(i));
    write(all);
    await mount();
    expect(host.textContent).toContain('Question number 399');
    expect(host.textContent).not.toContain('Question number 400');

    all.push(ev(400)); // oldest evicted, still 400 stored
    write(all);
    expect(JSON.parse(localStorage.getItem(STORE)!).length).toBe(400);
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: STORE })); });
    expect(host.textContent).toContain('Question number 400');
  });

  it('refreshes on the polling interval without a storage event', async () => {
    const all = Array.from({ length: 400 }, (_, i) => ev(i));
    write(all);
    await mount();
    all.push(ev(400));
    write(all);
    await act(async () => { await new Promise((r) => setTimeout(r, 1700)); });
    expect(host.textContent).toContain('Question number 400');
  });

  it('labels the live panel as this browser’s local events and the rest as simulated', async () => {
    write([ev(1)]);
    await mount();
    expect(host.textContent).toContain('This browser’s local events');
    expect(host.textContent).toMatch(/not partner-wide analytics/);
    expect(host.textContent).toContain('All figures except the panel of this browser’s local events are simulated demo data.');
    expect(host.textContent).not.toContain('This demo session');
  });

  it('tolerates malformed stored events without crashing', async () => {
    localStorage.setItem(STORE, '{not json');
    await mount();
    expect(host.textContent).toContain('No events yet');

    localStorage.setItem(STORE, JSON.stringify({ type: 'question' }));
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: STORE })); });
    expect(host.textContent).toContain('No events yet');

    localStorage.setItem(STORE, JSON.stringify([null, 7, 'x', ev(5)]));
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: STORE })); });
    expect(host.textContent).toContain('Question number 5');
  });

  it('clears the stored ring and picks up events written after clearing', async () => {
    write([ev(1)]);
    await mount();
    const button = Array.from(host.querySelectorAll('div')).find((d) => d.textContent === 'Clear local events') as HTMLElement;
    await act(async () => { button.click(); });
    expect(localStorage.getItem(STORE)).toBeNull();
    expect(host.textContent).toContain('No events yet');

    write([ev(2)]);
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: STORE })); });
    expect(host.textContent).toContain('Question number 2');
  });

  it('removes its storage listener on unmount', async () => {
    const added: unknown[] = [];
    const removed: unknown[] = [];
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    window.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, o?: unknown) => { if (type === 'storage') added.push(fn); return add(type, fn, o as AddEventListenerOptions); }) as typeof window.addEventListener;
    window.removeEventListener = ((type: string, fn: EventListenerOrEventListenerObject, o?: unknown) => { if (type === 'storage') removed.push(fn); return remove(type, fn, o as EventListenerOptions); }) as typeof window.removeEventListener;
    try {
      await mount();
      expect(added.length).toBe(1);
      await act(async () => root.unmount());
      expect(removed).toEqual(added);
    } finally {
      window.addEventListener = add;
      window.removeEventListener = remove;
      root = createRoot(document.createElement('div'));
    }
  });
});
