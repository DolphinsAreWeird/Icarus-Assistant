// Runs Oasis's REAL prototype file (unchanged) through the runtime, in a simulated browser,
// and checks that it pairs with the voice stack the way we say it does.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDcApp, installHelmet } from '../src/dc-runtime';
import { attachTts, createScribeRecognition, type VoiceLike } from '../src/voice-bridge';
import { setMascotFallback } from '../src/assets';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HTML = readFileSync(path.join(__dirname, '../prototype/Icarus Prototype.dc.html'), 'utf8');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A stand-in for IcarusVoice: records what the bridge asks of it, and lets the test play the user. */
class FakeVoice implements VoiceLike {
  handlers: Record<string, Array<(p: never) => void>> = {};
  spoken: Array<{ text: string; language?: string }> = [];
  startCalls = 0;
  stopCalls = 0;
  stopSpeakingCalls = 0;
  language = '';
  private finishSpeech: (() => void) | null = null;
  on(event: string, handler: (p: never) => void) {
    (this.handlers[event] ??= []).push(handler);
    return () => undefined;
  }
  emit(event: string, payload: unknown) {
    for (const h of this.handlers[event] ?? []) h(payload as never);
  }
  async start() { this.startCalls++; }
  stop() { this.stopCalls++; }
  setLanguage(l: string) { this.language = l; }
  speak(text: string, opts: { language?: string } = {}) {
    this.spoken.push({ text, ...(opts.language ? { language: opts.language } : {}) });
    return new Promise<'finished'>((resolve) => { this.finishSpeech = () => resolve('finished'); });
  }
  stopSpeaking() { this.stopSpeakingCalls++; this.finishSpeech?.(); }
  /** The line ended by itself. */
  endSpeech() { this.finishSpeech?.(); }
}

let root: Root;
let host: HTMLElement;
let voice: FakeVoice;
let instance: { goBack?: () => void } | null = null;

beforeEach(async () => {
  document.head.innerHTML = '';
  document.body.innerHTML = '<div id="root"></div>';
  host = document.getElementById('root') as HTMLElement;
  setMascotFallback(true);
  voice = new FakeVoice();

  // The bridge puts its look-alike in place before the prototype starts. (installVoice does this in the app.)
  const Recognition = createScribeRecognition(voice, undefined, () => (instance as { state?: { asst?: string } } | null)?.state?.asst === 'voice');
  Object.assign(window, { SpeechRecognition: Recognition, webkitSpeechRecognition: Recognition });

  const app = createDcApp(HTML);
  installHelmet(app.helmet);
  root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(app.Root, { instanceRef: (c: unknown) => (instance = c as typeof instance) }));
  });
  expect(attachTts(voice)).toBe(true);
});

afterEach(async () => {
  await act(async () => root.unmount());
  delete (window as { Icarus?: unknown }).Icarus;
  setMascotFallback(false);
});

describe('the real prototype file runs', () => {
  it('renders the home screen from the unchanged design file', () => {
    expect(host.textContent).toContain('Welcome!');
    expect(host.querySelectorAll('svg').length).toBeGreaterThan(5);
    expect(host.querySelectorAll('div').length).toBeGreaterThan(100);
  });

  it('puts the fonts and global CSS from <helmet> in the page head', () => {
    expect(document.head.querySelector('link[href*="fonts.googleapis.com/css2"]')).toBeTruthy();
    expect(document.head.textContent).toContain('@keyframes icPulse');
  });

  it('exposes the Icarus API that the voice bridge hooks into', () => {
    const icarus = (window as unknown as { Icarus: Record<string, unknown> }).Icarus;
    for (const name of ['setBackend', 'setTTS', 'pushTranscript', 'startVoice', 'send', 'highlight']) {
      expect(typeof icarus[name], name).toBe('function');
    }
  });

  it('switches screens when you tap (state and re-render work)', async () => {
    const before = host.textContent;
    const tappable = [...host.querySelectorAll<HTMLElement>('div')].filter((el) => el.style.cursor === 'pointer');
    const target = tappable.find((el) => /Invest|Portfolio|Gold|Bitcoin/i.test(el.textContent ?? ''));
    expect(tappable.length, 'tappable elements').toBeGreaterThan(5);
    expect(target, `a tappable item (saw: ${tappable.slice(0, 8).map((e) => (e.textContent ?? '').slice(0, 14)).join(' | ')})`).toBeTruthy();
    await act(async () => { target?.click(); });
    expect(host.textContent).not.toBe(before);
  });
});

describe('paired with our voice stack', () => {
  const icarus = () => (window as unknown as { Icarus: { startVoice: () => void; getContext: () => { screen: string } } }).Icarus;

  it('speaks the greeting through OUR text-to-speech, in English', async () => {
    await act(async () => icarus().startVoice());
    await sleep(20);
    expect(voice.spoken).toHaveLength(1);
    expect(voice.spoken[0]?.text).toMatch(/^Hi John/);
    expect(voice.spoken[0]?.language).toBe('en');
  });

  it('listens through OUR speech-to-text: the prototype starts recognition and gets the words', async () => {
    await act(async () => icarus().startVoice());
    await sleep(20);
    await act(async () => voice.endSpeech()); // the greeting ends, the prototype starts listening
    await sleep(150);
    expect(voice.startCalls).toBeGreaterThan(0); // the mic was started through the bridge
    expect(voice.language).toBe('en');

    // The user talks: partial, then final.
    await act(async () => voice.emit('partialTranscript', { text: 'show me' }));
    expect(host.textContent).toContain('show me'); // the prototype shows what it is hearing
    await act(async () => voice.emit('finalTranscript', { text: 'show me gold' }));
    await sleep(900); // the prototype's demo assistant answers after a short delay
    expect(voice.spoken.length).toBeGreaterThanOrEqual(2); // and the answer goes out through OUR speech
    expect(voice.spoken.at(-1)?.text.length).toBeGreaterThan(5);
  });

  it('while Icarus talks, the prototype is not listening: sounds and words from the mic cannot cut it off here', async () => {
    // Only the voice module may stop Icarus for speech, and only for real, sustained speech (voice/src/client/barge-in.ts).
    await act(async () => icarus().startVoice());
    await sleep(20);
    expect(host.textContent).toContain('tap me to interrupt'); // the greeting is playing
    const stopsBefore = voice.stopSpeakingCalls; // (opening the voice window clears any earlier line once)
    await act(async () => voice.emit('partialTranscript', { text: 'so I told him' }));
    await act(async () => voice.emit('finalTranscript', { text: 'so I told him we should leave' }));
    await sleep(700);
    expect(voice.stopSpeakingCalls).toBe(stopsBefore);
    expect(voice.spoken).toHaveLength(1); // nothing was answered
    expect(host.textContent).toContain('tap me to interrupt'); // still speaking
  });

  it('tapping the mascot stops Icarus at once', async () => {
    await act(async () => icarus().startVoice());
    await sleep(20);
    const mascot = host.querySelector('[data-ui-id="icarus.voice_dock"] [aria-label="Icarus"]')?.parentElement;
    expect(mascot, 'the mascot in the voice window').toBeTruthy();
    const stopsBefore = voice.stopSpeakingCalls;
    await act(async () => mascot?.click());
    expect(voice.stopSpeakingCalls).toBe(stopsBefore + 1);
    expect(host.textContent).not.toContain('tap me to interrupt');
  });

  it('lets the voice module handle commands like "stop" (the prototype never sees them)', async () => {
    await act(async () => icarus().startVoice());
    await sleep(20);
    await act(async () => voice.endSpeech());
    await sleep(150);
    const spokenBefore = voice.spoken.length;
    await act(async () => voice.emit('finalTranscript', { text: 'stop' }));
    await sleep(700);
    expect(voice.spoken.length).toBe(spokenBefore); // no new answer was produced for "stop"
  });

  it('speaks Thai with the Thai language setting', async () => {
    await act(async () => icarus().startVoice());
    await sleep(20);
    await act(async () => voice.endSpeech());
    await sleep(100);
    // Switch the prototype to Thai the way the UI does, then have it say something.
    const thai = [...host.querySelectorAll<HTMLElement>('div')].find((el) => el.textContent === 'TH' || el.textContent === 'ไทย');
    expect(thai, 'a Thai toggle').toBeTruthy();
    await act(async () => thai?.click());
    await act(async () => voice.emit('finalTranscript', { text: 'ดูราคาทองคำ' }));
    await sleep(900);
    expect(voice.spoken.some((s) => s.language === 'th')).toBe(true);
    expect(voice.language).toBe('th');
  });

  it('degrades to the prototype\'s tap-a-phrase demo if the mic cannot start', async () => {
    await act(async () => icarus().startVoice());
    await sleep(20);
    await act(async () => voice.endSpeech());
    await sleep(150);
    await act(async () => voice.emit('error', { code: 'mic_denied', message: 'blocked', fatal: true }));
    await sleep(50);
    expect(host.textContent).toMatch(/tap a phrase|แตะประโยค/i);
  });

  it('stops the mic a while after the prototype stops listening', async () => {
    vi.useFakeTimers();
    try {
      await act(async () => icarus().startVoice());
      await vi.advanceTimersByTimeAsync(20);
      await act(async () => voice.endSpeech());
      await vi.advanceTimersByTimeAsync(150);
      const rec = new (window as unknown as { SpeechRecognition: new () => { start(): void; abort(): void } }).SpeechRecognition();
      rec.start();
      rec.abort();
      await vi.advanceTimersByTimeAsync(19_000);
      expect(voice.stopCalls).toBe(0); // still lingering, so Icarus can be interrupted
      await vi.advanceTimersByTimeAsync(2_000);
      expect(voice.stopCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the mic is only on while the voice window is open', () => {
  it('turns the mic off and stops talking as soon as the user closes voice', async () => {
    const c = instance as unknown as { startVoice: () => void; endVoice: () => void };
    await act(async () => { c.startVoice(); await sleep(50); });
    voice.endSpeech(); // greeting done, now listening
    await act(async () => { await sleep(300); });
    expect(voice.startCalls).toBeGreaterThan(0); // the mic is on
    const before = voice.stopCalls;
    await act(async () => { c.endVoice(); });
    await act(async () => { await sleep(700); });
    expect(voice.stopCalls).toBeGreaterThan(before);
  });
});
