// Entry point: load Oasis's prototype file, run it with the dc-runtime, pair it with the voice stack.

import React from 'react';
import { createRoot } from 'react-dom/client';
import { setMascotFallback } from './assets';
import { createDcApp, installHelmet } from './dc-runtime';
import { attachTts, installVoice } from './voice-bridge';

const PROTOTYPE_URL = 'prototype/Icarus%20Prototype.dc.html';

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
  const status = createStatusPill();
  const res = await fetch(PROTOTYPE_URL);
  if (!res.ok) throw new Error(`Could not load the prototype (${res.status}).`);
  const html = await res.text();

  // Use the real mascot images if they are served next to the app. If not, draw placeholders.
  const hasMascots = await fetch('mascot/bow/hero.png', { method: 'HEAD' }).then((r) => r.ok && (r.headers.get('content-type') ?? '').startsWith('image/'), () => false);
  setMascotFallback(!hasMascots);
  const app = createDcApp(html);

  installHelmet(app.helmet);

  let instance: { goBack?: () => void } | null = null;
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
    if (attachTts(voice)) {
      clearInterval(wait);
      void describeServer().then((text) => status(text));
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
