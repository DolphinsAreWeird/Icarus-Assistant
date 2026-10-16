// Entry point: load Oasis's prototype file, run it with the dc-runtime, pair it with the voice stack.

import React from 'react';
import { createRoot } from 'react-dom/client';
import { setMascotFallback } from './assets';
import { DEFAULT_USER, backendFromLocation, installBackend, toPrototypeAction, type PrototypeLike } from './backend-bridge';
import { hideInfoCard, showChartCard, showStepsCard, type ChartCardData, type StepsCardData } from './chat-cards';
import { createDcApp, installHelmet } from './dc-runtime';
import { hideHandoffCard, showHandoffCard } from './handoff-card';
import { hideTradeCard, showTradeCard } from './trade-card';
import { renderUbotMock } from './ubot-mock';
import { withJudgeCopy } from './judge-copy';
import { installTour, type TourInstance } from './tour';
import { installUtopiaRouting, withUtopiaRouting, type PrototypeInstance } from './utopia-bridge';
import { attachTts, installVoice } from './voice-bridge';
import { installDemoData } from './demo-data';

// Oasis's export has two pages that link to each other by file name. ?page=dashboard picks the second.
const PAGES: Record<string, string> = {
  'Icarus Prototype.dc.html': './',
  'Icarus Business Dashboard.dc.html': './?page=dashboard',
};
const PARAMS = new URLSearchParams(location.search);
const IS_DASHBOARD = PARAMS.get('page') === 'dashboard';
// ?page=ubot&session=<id>: the U-Bot mock that a handoff opens (ubot-mock.ts).
const IS_UBOT_MOCK = PARAMS.get('page') === 'ubot';
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

/**
 * Which backend answers. ?backend=<url> picks one (local runs). Otherwise the hosted demo's own (/brain on this
 * address, announced by /api/health). ?backend=off: the prototype's scripted answers only.
 */
async function pickBackend(): Promise<{ url: string; userId: string } | null> {
  if (PARAMS.get('backend') === 'off') return null;
  const fromUrl = backendFromLocation(location.search);
  if (fromUrl) return fromUrl;
  const health = await fetch('/api/health').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (typeof health?.backend !== 'string') return null;
  return { url: new URL(health.backend, location.href).href.replace(/\/+$/, ''), userId: visitorUser() };
}

/**
 * On the hosted demo every visitor gets their own copy of the demo account (backend/app/state.py), so one judge's
 * purchases never show up for the next. The id is kept in this browser so a reload keeps the same account.
 */
function visitorUser(): string {
  let id = '';
  try {
    id = localStorage.getItem('icarus.visitor') ?? '';
  } catch {
    // storage blocked: a fresh account for this page view
  }
  if (!/^[a-z0-9]{10}$/.test(id)) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
    try {
      localStorage.setItem('icarus.visitor', id);
    } catch {
      // fine: see above
    }
  }
  return `${DEFAULT_USER}-${id}`;
}

/**
 * A small pill under the phone: what the voice stack is doing, and any problem. Information fades after 10 s so it
 * never covers a card; an error stays until clicked. It sits below the cards (z-index 8000 against their 9000+).
 * Only with ?debug: visitors never see it (messages go to the console instead).
 */
function createStatusPill(): (text: string, kind?: 'info' | 'error') => void {
  if (!PARAMS.has('debug')) {
    return (text, kind = 'info') => (kind === 'error' ? console.warn : console.info)(`[icarus] ${text}`);
  }
  const pill = document.createElement('div');
  pill.style.cssText =
    'position:fixed;left:50%;bottom:10px;transform:translateX(-50%);max-width:92vw;padding:6px 14px;border-radius:999px;' +
    'font:12px/1.4 ui-monospace,Menlo,monospace;background:#fff;color:#4A2E36;box-shadow:0 2px 12px rgba(150,60,85,.2);z-index:8000;cursor:pointer';
  pill.title = 'Click to hide';
  pill.onclick = () => (pill.style.display = 'none');
  document.body.appendChild(pill);
  let timer = 0;
  return (text, kind = 'info') => {
    pill.textContent = text;
    pill.style.color = kind === 'error' ? '#C0332B' : '#4A2E36';
    pill.style.display = 'block';
    window.clearTimeout(timer);
    if (kind === 'info') timer = window.setTimeout(() => (pill.style.display = 'none'), 10_000);
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
  if (IS_UBOT_MOCK) {
    await renderUbotMock(document.getElementById('root') as HTMLElement, { sessionId: PARAMS.get('session') });
    return;
  }
  routePageLinks();
  const [res, backend] = await Promise.all([fetch(PAGE_URL), IS_DASHBOARD ? null : pickBackend()]);
  if (!res.ok) throw new Error(`Could not load the page (${res.status}).`);
  // With a backend the fee follows the backend's rule (demo-data.ts), so the design's fixed "(1%)" label would be
  // wrong next to the amount. The amount on the screen is the backend's; the label just says what it is.
  // The side console speaks to visitors on their own, not to a presenter (judge-copy.ts).
  const page = withJudgeCopy(await res.text(), { liveData: Boolean(backend) });
  const html = backend ? page.replaceAll('Transaction fee (1%)', 'Transaction fee') : page;

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
      // With a backend, answers come from Luka and First's backend instead of the demo answers (backend-bridge.ts).
      if (backend) {
        const demo = installDemoData(instance, backend.url, backend.userId, message => status(message, 'error'));
        // Keep trying: on the hosted demo the backend may still be starting (or restarting after a deploy).
        const loadAccount = (attempt: number): void => {
          demo.refresh().catch((error: Error) => {
            status(`Demo account could not load: ${error.message}`, 'error');
            if (attempt < 60) window.setTimeout(() => loadAccount(attempt + 1), Math.min(10_000, 2_000 + attempt * 500));
          });
        };
        loadAccount(0);
        demo.startAutoRefresh();
        installBackend({
          ...backend,
          getInstance: () => instance as PrototypeLike | null,
          ready: demo.ready,
          wrap: (ask) => withUtopiaRouting(utopia, ask),
          hideCards: () => {
            hideTradeCard();
            hideInfoCard();
          },
          showChart: (card, lang) => showChartCard(card as unknown as ChartCardData, { lang, getPhone }),
          showSteps: (card, lang) =>
            showStepsCard(card as unknown as StepsCardData, {
              lang,
              getPhone,
              // "Show me" runs the backend's own pointing actions on the prototype.
              runActions: (actions) =>
                (window as unknown as { Icarus?: { runActions?: (a: unknown[]) => void } }).Icarus?.runActions?.(
                  actions.map(toPrototypeAction).filter((a): a is Record<string, unknown> => a !== null),
                ),
            }),
          showTrade: (card, lang) =>
            showTradeCard(card, {
              lang,
              backendUrl: backend.url,
              userId: backend.userId,
              getPhone,
              log: (type, data) => (instance as { log?: (t: string, d?: unknown) => void } | null)?.log?.(type, data),
              onConfirmed: (_result, sentence) => {
                void demo.confirmed().catch(error => status(`Purchase confirmed; account refresh failed: ${error.message}`, 'error'));
                (window as unknown as { Icarus?: { receiveResponse?: (r: unknown) => void } }).Icarus?.receiveResponse?.({
                  text: sentence, speech: sentence, emotion: 'excited', speak: true, ui_actions: [],
                  sources: ['confirm_trade · demo account (simulated)'], suggestions: [], offer: null,
                });
              },
            }),
        });
      }
      // The mascot's one-minute tour (tour.ts): offered on a first visit, and from the "Tour" pill any time.
      const tourParam = PARAMS.get('tour');
      installTour(
        {
          getInstance: () => instance as unknown as TourInstance | null,
          getPhone,
          showHandoff: (info) => showHandoffCard(info, { th: false, getPhone }),
          hideCards: () => {
            hideTradeCard();
            hideInfoCard();
            hideHandoffCard();
          },
        },
        { offer: tourParam === '0' ? 'never' : tourParam === '1' ? 'always' : 'auto' },
      );
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
