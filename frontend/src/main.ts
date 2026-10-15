// Entry point: load Oasis's prototype file, run it with the dc-runtime, pair it with the voice stack.

import React from 'react';
import { createRoot } from 'react-dom/client';
import { setMascotFallback } from './assets';
import { backendFromLocation, installBackend } from './backend-bridge';
import { createDcApp, installHelmet } from './dc-runtime';
import { hideHandoffCard, showHandoffCard } from './handoff-card';
import { hideTradeCard, showTradeCard } from './trade-card';
import { installUtopiaRouting, withUtopiaRouting, type PrototypeInstance } from './utopia-bridge';
import { attachTts, installVoice } from './voice-bridge';

// Oasis's export has two pages that link to each other by file name. ?page=dashboard picks the second.
const PAGES: Record<string, string> = {
  'Icarus Prototype.dc.html': './',
  'Icarus Business Dashboard.dc.html': './?page=dashboard',
};
const IS_DASHBOARD = new URLSearchParams(location.search).get('page') === 'dashboard';
const PAGE_URL = IS_DASHBOARD
  ? 'prototype/Icarus%20Business%20Dashboard.dc.html'
  : 'prototype/Icarus%20Prototype.dc.html';

/** Send links to the other .dc.html page to its route in this app. */
function routePageLinks() {
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a');
    const href = a?.getAttribute('href');
    if (!href) return;
    const target = PAGES[decodeURIComponent(href)];
    if (target) {
      e.preventDefault();
      location.href = target;
    }
  });
}

/** A small pill under the phone: what the voice stack is doing, and any problem. */
function createStatusPill(): (text: string, kind?: 'info' | 'error') => void {
  const pill = document.createElement('div');
  pill.style.cssText =
    'position:fixed;left:50%;bottom:10px;transform:translateX(-50%);max-width:92vw;padding:6px 14px;border-radius:999px;' +
    'font:12px/1.4 ui-monospace,Menlo,monospace;background:#fff;color:#4A2E36;box-shadow:0 2px 12px rgba(150,60,85,.2);z-index:9999;cursor:pointer';
  pill.title = 'Click to hide';
  pill.onclick = () => (pill.style.display = 'none');
  document.body.appendChild(pill);
  return (text, kind = 'info') => {
    pill.textContent = text;
    pill.style.color = kind === 'error' ? '#C0332B' : '#4A2E36';
    pill.style.display = 'block';
  };
}

async function describeServer(): Promise<string> {
  try {
    const h = await (await fetch('/api/health')).json();
    if (h.fakeElevenLabs) return 'Voice: FAKE mode (beeps, scripted transcripts)';
    if (!h.apiKeySet) return 'Voice: server has no ElevenLabs key. The browser voice will be used.';
    const en = h.ttsModels.en[0];
    const th = h.ttsModels.th[0];
    return `Voice: ElevenLabs. Speech: EN ${en}, TH ${th}. Listening: Scribe v2 Realtime.`;
  } catch {
    return 'Voice server not reachable. Browser voice only, and tap-a-phrase demo for listening.';
  }
}

async function main() {
  routePageLinks();
  const res = await fetch(PAGE_URL);
  if (!res.ok) throw new Error(`Could not load the page (${res.status}).`);
  const html = await res.text();

  // Use the real mascot images if they are served next to the app. If not, draw placeholders.
  const hasMascots = await fetch('mascot/bow/hero.png', { method: 'HEAD' }).then((r) => r.ok && (r.headers.get('content-type') ?? '').startsWith('image/'), () => false);
  setMascotFallback(!hasMascots);
  const app = createDcApp(html);

  installHelmet(app.helmet);

  // The dashboard has no assistant, so it needs no voice.
  if (IS_DASHBOARD) {
    createRoot(document.getElementById('root') as HTMLElement).render(React.createElement(app.Root, {}));
    return;
  }

  const status = createStatusPill();

  let instance: (PrototypeInstance & { goBack?: () => void }) | null = null;
  const voice = installVoice({
    getComponent: () => instance,
    onStatus: (s) => status(s.text, s.kind),
  });

  createRoot(document.getElementById('root') as HTMLElement).render(
    React.createElement(app.Root, { instanceRef: (c: unknown) => (instance = c as typeof instance) }),
  );

  // window.Icarus is created when the prototype mounts, one tick later.
  const started = Date.now();
  const wait = setInterval(() => {
    // Wait for the instance too: the U-topia routing below wraps the prototype's own answers.
    if (attachTts(voice, () => instance) && instance) {
      clearInterval(wait);
      const getPhone = () => document.querySelector('[data-screen-label="Phone"]');
      // "Ask U-topia" answers and handoffs to U-Bot, wrapped around the prototype's own answers.
      const utopia = {
        getInstance: () => instance,
        showCard: (handoff: Parameters<typeof showHandoffCard>[0], th: boolean) => showHandoffCard(handoff, { th, getPhone }),
        hideCard: hideHandoffCard,
      };
      installUtopiaRouting(utopia);
      // ?backend: answers come from Luka and First's backend instead of the demo answers (backend-bridge.ts).
      const backend = backendFromLocation(location.search);
      if (backend) {
        installBackend({
          ...backend,
          getInstance: () => instance as { state?: { asst?: string } } | null,
          wrap: (ask) => withUtopiaRouting(utopia, ask),
          hideTrade: hideTradeCard,
          showTrade: (card, lang) =>
            showTradeCard(card, {
              lang,
              backendUrl: backend.url,
              userId: backend.userId,
              getPhone,
              log: (type, data) => (instance as { log?: (t: string, d?: unknown) => void } | null)?.log?.(type, data),
              onConfirmed: (_result, sentence) =>
                (window as unknown as { Icarus?: { receiveResponse?: (r: unknown) => void } }).Icarus?.receiveResponse?.({
                  text: sentence, speech: sentence, emotion: 'excited', speak: true, ui_actions: [],
                  sources: ['confirm_trade · demo account (simulated)'], suggestions: [], offer: null,
                }),
            }),
        });
      }
      void describeServer().then((text) => status(backend ? `${text} Brain: backend at ${backend.url} (user ${backend.userId}).` : text));
    } else if (Date.now() - started > 5000) {
      clearInterval(wait);
      status('Could not attach text-to-speech: window.Icarus was not created.', 'error');
    }
  }, 50);
}

main().catch((err) => {
  console.error(err);
  document.body.textContent = `Icarus app failed to start: ${(err as Error).message}`;
});
