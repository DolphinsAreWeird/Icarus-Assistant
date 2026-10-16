// Mock-up mode on the real prototype: press the Icarus button, wait, and the scripted request is heard. No microphone.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDcApp, installHelmet } from '../src/dc-runtime';
import { setMascotFallback } from '../src/assets';
import { installMockVoice, MOCK_PHRASE } from '../src/mock-voice';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const HTML = readFileSync(path.join(__dirname, '../prototype/Icarus Prototype.dc.html'), 'utf8');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let root: Root;
let proto: Record<string, any>;

beforeEach(async () => {
  localStorage.clear();
  document.head.innerHTML = '';
  document.body.innerHTML = '<div id="root"></div>';
  setMascotFallback(true);
  const app = createDcApp(HTML);
  installHelmet(app.helmet);
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => {
    root.render(React.createElement(app.Root, { instanceRef: (c: unknown) => { if (c) proto = c as Record<string, any>; } }));
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  delete (window as { Icarus?: unknown }).Icarus;
  setMascotFallback(false);
});

describe('mock voice', () => {
  it('waits, then hears the scripted request, and never opens the microphone', async () => {
    const sent: string[] = [];
    const rec = vi.fn();
    (window as any).SpeechRecognition = rec;
    installMockVoice(proto, { waitMs: 150 });
    proto.finishUtterance = (text: string) => sent.push(text);
    await act(async () => proto.startVoice());
    expect(proto.state.asst).toBe('voice');
    expect(proto.state.voice.phase).toBe('listening');
    await act(async () => { await sleep(80); });
    expect(sent).toEqual([]); // still waiting
    expect(proto.state.voice.transcript).toBe('');
    await act(async () => { await sleep(1500); });
    expect(sent).toEqual([MOCK_PHRASE]);
    proto.listen(); // after an answer the app listens again: still no microphone
    await act(async () => { await sleep(150); });
    expect(rec).not.toHaveBeenCalled();
    delete (window as any).SpeechRecognition;
  });

  it('closing before the wait ends means nothing is heard', async () => {
    const sent: string[] = [];
    installMockVoice(proto, { waitMs: 150 });
    proto.finishUtterance = (text: string) => sent.push(text);
    await act(async () => proto.startVoice());
    await act(async () => { proto.hideAsst('min'); await sleep(2200); });
    expect(sent).toEqual([]);
  });
});
