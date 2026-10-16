// The mascot's one-minute tour, for visitors with nobody to show them around (the hosted demo for judges).
//
// It plays on the app's own voice window: the mascot "hears" a short question, answers out loud and moves through
// the real screens, and stops at Confirm. The answers are scripted on purpose, so the tour works even when a model
// or the voice API is down; everything after the tour is live. The mic stays off while it plays.
//
//   First visit: a "Meet Icarus" card offers the tour (a tap is needed anyway, browsers block sound until one).
//   Any time: the "Tour" pill in the corner. ?tour=0 never offers it, ?tour=1 always does.

import { buyReadback, type PrototypeLike } from './backend-bridge';
import type { HandoffInfo } from './handoff-card';
import { createGuide, type GuideHost } from './tour-guide';
import { buildUbotPrompt } from '../../voice/src/shared/ubot-prompt';

type Lang = 'en' | 'th';
type Action = Record<string, unknown>;

interface Reply {
  text: string;
  speech: string;
  emotion: string;
  speak: true;
  ui_actions: Action[];
  sources: string[];
  suggestions: string[];
  offer: null;
}

/** The parts of the prototype's component the tour drives (Oasis's .dc.html). */
export interface TourInstance {
  state: Record<string, unknown> & { voice?: { phase?: string } | null; lang?: string; messages?: unknown[] };
  setState: (patch: Record<string, unknown>, done?: () => void) => void;
  startVoice: () => void;
  simulate: (phrase: string) => void;
  say: (line: string, emotion?: string, after?: () => void, acts?: Action[]) => void;
  setLang: (lang: Lang) => void;
  endVoice: () => void;
  openAsst: () => void;
  stopVoiceStuff: () => void;
  getContext: () => unknown;
  backend: ((text: string, ctx: unknown) => Promise<unknown>) | null;
  startRec: () => void;
  greeting: (ctx: unknown, th: boolean) => string;
  log?: (type: string, data?: unknown) => void;
}

export interface TourDeps {
  getInstance: () => TourInstance | null;
  /** The phone screen, so the mascot knows where to fly. */
  getPhone: () => Element | null;
  showHandoff: (info: HandoffInfo) => void;
  /** Hide every floating card (trade, chart, steps, U-Bot). */
  hideCards: () => void;
  ubotUrl?: string;
}

const HELLO = "Hi, I'm Icarus! I live inside your finance app. Ask me anything, out loud or by typing, in English or Thai.";
const BYE = "That's the tour. Your turn now! Tap the mic, or type anything.";
const RIDE = 'Book me a ride to Siam Paragon';

const reply = (speech: string, ui_actions: Action[] = [], emotion = 'happy'): Reply => ({
  text: speech, speech, emotion, speak: true, ui_actions, sources: [], suggestions: [], offer: null,
});

interface Step {
  /** What the visitor "says". */
  ask: string;
  lang: Lang;
  answer: (inst: TourInstance) => Reply;
  /** After the answer has been spoken. */
  after?: (deps: TourDeps) => void;
  pointAfter?: () => Element | null;
}

const BUY: Action[] = [
  { type: 'start_buy', asset: 'XAU' },
  { type: 'type_amount', value: 1000 },
  { type: 'select_wallet', wallet: 'thb' },
  { type: 'review' },
];

export const STEPS: Step[] = [
  {
    ask: 'How did gold do this year?',
    lang: 'en',
    answer: () => reply("Here's gold over the past year. I show you what happened, not predictions.", [
      { type: 'open_asset', asset: 'XAU' },
      { type: 'set_period', period: '1Y' },
      { type: 'highlight', target: 'asset.chart' },
    ]),
  },
  {
    ask: 'Should I buy some?',
    lang: 'en',
    // No nudge to buy right after refusing to pick (house rule 1): offer facts instead.
    answer: () => reply("That's your call, so I won't pick for you. I can show you how gold's price has moved, or explain what it is.", [], 'curious'),
  },
  {
    ask: 'Put 1,000 baht in gold',
    lang: 'en',
    // The exact amount, fee and total from the buy screen itself, read back the way a real answer is.
    answer: (inst) => reply(
      buyReadback(BUY, inst.getContext() as never, inst as unknown as PrototypeLike, 'en')
        ?? "It's filled in. Check the fee and the total, then tap Confirm purchase when you're ready.",
      [...BUY, { type: 'highlight', target: 'buy.confirm_button' }],
      'excited',
    ),
  },
  {
    ask: 'ทองคำวันนี้เป็นยังไงบ้าง',
    lang: 'th',
    answer: () => reply('นี่คือราคาทองคำวันนี้ค่ะ ดูการเปลี่ยนแปลงได้ตรงนี้เลย', [
      { type: 'open_asset', asset: 'XAU' },
      { type: 'set_period', period: '1D' },
      { type: 'highlight', target: 'asset.change24h' },
    ]),
  },
  {
    ask: RIDE,
    lang: 'en',
    answer: () => reply("That's a job for U-Bot, U-topia's own assistant. I've written the request for you."),
    after: (deps) => deps.showHandoff({
      label: 'Open U-Bot',
      message: "That's a job for U-Bot. I've written the request for you.",
      url: deps.ubotUrl ?? 'https://u.bot/',
      question: RIDE,
      reason: 'commerce',
      prompt: buildUbotPrompt(RIDE, 'commerce', 'en', { screen: 'Gold page', asset: 'Gold' }),
    }),
    /** What the mascot points at once `after` has run. */
    pointAfter: () => document.getElementById('icarus-handoff'),
  },
];

const PINK = '#C94F72';
const FONT = 'Fredoka,Mali,system-ui,sans-serif';
const SEEN = 'icarus.tour.seen';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const storage = {
  seen: () => {
    try {
      return localStorage.getItem(SEEN) === '1';
    } catch {
      return false;
    }
  },
  markSeen: () => {
    try {
      localStorage.setItem(SEEN, '1');
    } catch {
      // storage blocked: the card shows again next time, which is fine
    }
  },
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (text) e.textContent = text;
  return e;
}

function button(text: string, primary: boolean): HTMLButtonElement {
  const b = el('button', primary
    ? `font:600 15px/1.2 ${FONT};background:${PINK};color:#fff;border:0;border-radius:22px;padding:12px 20px;cursor:pointer;box-shadow:0 6px 16px rgba(201,79,114,.3)`
    : `font:500 14px/1.2 ${FONT};background:#fff;color:#4A2E36;border:1px solid #F2DCE2;border-radius:22px;padding:11px 18px;cursor:pointer`, text);
  b.type = 'button';
  return b;
}

export function installTour(deps: TourDeps, opts: { offer: 'auto' | 'always' | 'never' } = { offer: 'auto' }): { play: () => Promise<void> } {
  let playing = false;
  let stopping = false;
  const guide = createGuide(deps.getPhone);

  // ---- "Tour" pill, top right ----
  const pill = button('▶  Tour', true);
  pill.setAttribute('aria-label', 'Play the one-minute tour');
  pill.style.cssText += ';position:fixed;top:14px;right:128px;z-index:9500;padding:9px 16px;font-size:14px';
  pill.onclick = () => void play();

  // ---- the bar while it plays ----
  const bar = el('div', `position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:9600;display:none;align-items:center;gap:10px;` +
    `background:#FFF7F9;border:1px solid #F7D2DC;border-radius:999px;padding:7px 8px 7px 16px;box-shadow:0 6px 20px rgba(150,60,85,.2);font:500 13px/1.2 ${FONT};color:#4A2E36`);
  const barText = el('span', '');
  const dots = el('span', 'display:inline-flex;gap:5px');
  const skip = button('Skip tour', false);
  skip.style.cssText += ';padding:6px 12px;font-size:12.5px';
  skip.onclick = () => stop();
  bar.append(barText, dots, skip);

  const total = STEPS.length + 2;
  const progress = (n: number) => {
    barText.textContent = 'Icarus tour';
    dots.replaceChildren(...Array.from({ length: total }, (_, i) =>
      el('span', `width:7px;height:7px;border-radius:50%;background:${i < n ? PINK : '#F2DCE2'}`)));
  };

  document.body.append(pill, bar);

  // ---- waiting on the voice window ----
  const phase = (inst: TourInstance) => inst.state.voice?.phase ?? 'closed';
  const until = async (inst: TourInstance, ok: (p: string) => boolean, ms: number) => {
    const end = Date.now() + ms;
    while (!stopping && Date.now() < end && !ok(phase(inst))) await wait(100);
  };
  const idle = (p: string) => p === 'listening' || p === 'asleep' || p === 'closed';
  /** Wait for an answer to start, then for it to finish (spoken and the screens moved). */
  const answered = async (inst: TourInstance) => {
    await until(inst, (p) => !idle(p), 4000);
    await until(inst, idle, 30_000);
  };

  function stop() {
    if (!playing) return;
    stopping = true;
    deps.getInstance()?.stopVoiceStuff();
  }

  async function play() {
    const inst = deps.getInstance();
    if (!inst || playing) return;
    playing = true;
    stopping = false;
    storage.markSeen();
    pill.style.display = 'none';
    bar.style.display = 'flex';
    progress(1);

    // Scripted answers and no mic while the tour plays. Everything is put back in `finally`.
    const saved = { backend: inst.backend, startRec: inst.startRec, greeting: inst.greeting, log: inst.log, messages: inst.state.messages };
    let current: Step | null = null;
    inst.backend = async () => (current ? current.answer(inst) : null);
    inst.startRec = () => undefined;
    inst.greeting = () => HELLO;
    if (saved.log) inst.log = () => undefined; // the tour's questions are not real friction

    try {
      deps.hideCards();
      inst.stopVoiceStuff();
      await new Promise<void>((done) => inst.setState({
        tab: 'home', view: 'invest', buyStep: 'amount', buyAmount: '', guide: null, hl: null, explain: null, flash: null,
        asst: 'closed', closing: false, voice: null, lang: 'en', hideBal: false, frozen: false,
      }, done));
      await wait(400);
      // The mascot flies in and stands by the balance while it says hello.
      guide.start(inst as unknown as GuideHost);
      window.setTimeout(() => guide.pointAt('home.balance'), 900);
      inst.startVoice(); // opens the (hidden) voice window and says HELLO
      await answered(inst);

      for (const [i, step] of STEPS.entries()) {
        if (stopping) break;
        progress(i + 2);
        if (inst.state.lang !== step.lang) {
          inst.setLang(step.lang);
          await wait(150);
        }
        current = step;
        await wait(500);
        inst.simulate(step.ask);
        await answered(inst);
        if (!stopping && step.after) {
          step.after(deps);
          await wait(350);
          guide.pointAt(step.pointAfter?.() ?? null);
        }
        await wait(step.after ? 3500 : 600); // time to read the U-Bot card
      }

      if (!stopping) {
        progress(total);
        if (inst.state.lang !== 'en') inst.setLang('en');
        await wait(200);
        guide.pointAt(null);
        inst.say(BYE, 'excited');
        await answered(inst);
        if (!stopping) await guide.goHome(); // into the Icarus button, where it lives
      }
    } finally {
      guide.stop();
      inst.backend = saved.backend;
      inst.startRec = saved.startRec;
      inst.greeting = saved.greeting;
      if (saved.log) inst.log = saved.log;
      inst.stopVoiceStuff();
      deps.hideCards();
      inst.setState({ tab: 'home', view: 'invest', buyStep: 'amount', buyAmount: '', lang: 'en', voice: null, asst: 'closed', messages: saved.messages ?? [] });
      // Leave the visitor in the chat, with the starter questions showing.
      setTimeout(() => inst.openAsst(), 350);
      bar.style.display = 'none';
      pill.style.display = '';
      playing = false;
      stopping = false;
    }
  }

  // ---- first visit: "Meet Icarus" ----
  const offer = opts.offer === 'always' || (opts.offer === 'auto' && !storage.seen());
  if (offer) showIntro(() => void play(), () => storage.markSeen());

  return { play };
}

function showIntro(onPlay: () => void, onSkip: () => void): void {
  const back = el('div', 'position:fixed;inset:0;z-index:10000;background:rgba(74,46,54,.28);backdrop-filter:blur(3px);' +
    'display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box');
  const card = el('div', `box-sizing:border-box;width:min(400px,100%);background:#FFF7F9;border:1px solid #F7D2DC;border-radius:28px;` +
    `padding:22px 22px 18px;text-align:center;box-shadow:0 18px 50px rgba(150,60,85,.3);font:500 14px/1.45 ${FONT};color:#4A2E36;animation:icPop .3s ease`);
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Meet Icarus');

  const img = el('img', 'width:132px;height:132px;object-fit:contain;margin:-6px auto 2px;display:block');
  img.src = 'mascot/bow/hero.png';
  img.alt = 'Icarus, waving';
  const title = el('div', `font:600 24px/1.2 ${FONT};color:${PINK};margin-bottom:6px`, 'Meet Icarus');
  const body = el('div', 'color:#6E5560;margin:0 4px 16px',
    'The guide inside your finance app. It answers out loud, walks you through the screens, and never buys without your tap.');
  const row = el('div', 'display:flex;flex-direction:column;gap:8px');
  const play = button('▶  Watch the 1-minute tour', true);
  const later = button("I'll explore on my own", false);
  const note = el('div', 'font-size:11.5px;color:#AE939B;margin-top:10px', 'Sound on. Real market prices when connected; the account is a demo, nothing real is bought.');
  row.append(play, later);
  card.append(img, title, body, row, note);
  back.append(card);
  document.body.append(back);

  const close = () => back.remove();
  play.onclick = () => {
    close();
    onPlay();
  };
  later.onclick = () => {
    close();
    onSkip();
  };
  back.onclick = (e) => {
    if (e.target === back) later.click();
  };
  play.focus();
}
