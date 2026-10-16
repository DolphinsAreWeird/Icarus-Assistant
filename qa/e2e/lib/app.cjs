// What the suite knows about the Icarus app: where things are and how to read them.
//
// The app is Oasis's prototype (frontend/prototype/*.dc.html) rendered by frontend/src/dc-runtime.ts. Its elements
// have few ids, so the selectors lean on what is stable: data-ui-id and data-screen-label (part of the design's own
// contract), title attributes, placeholders, the ids of the cards Icarus adds (icarus-info-card, icarus-handoff,
// icarus-trade), and visible words. Nothing here changes the app.

const INPUT_PLACEHOLDER = 'Ask Icarus anything…';
const STARTER_CHIPS = ['Explain this chart', 'Show me how to buy', 'Compare assets', 'Explain my portfolio'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Open the app and wait for the prototype to mount (window.Icarus). Returns the time it took. */
async function gotoApp(page, base, query = '') {
  const t0 = Date.now();
  await page.goto(base + query, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.Icarus && typeof window.Icarus.getContext === 'function'), null, { timeout: 20_000 });
  return Date.now() - t0;
}

/** The demo account from the backend has loaded (the balance switches to baht). Returns ms, throws on timeout. */
async function waitDemoAccount(page, timeout = 20_000) {
  const t0 = Date.now();
  await page.waitForFunction(() => /฿/.test(document.querySelector('[data-ui-id="home.balance"]')?.innerText ?? ''), null, { timeout, polling: 200 });
  return Date.now() - t0;
}

const introCard = (page) => page.locator('[role="dialog"][aria-label="Meet Icarus"]');

async function dismissIntro(page) {
  const later = page.getByRole('button', { name: /explore on my own/i });
  if (await later.isVisible().catch(() => false)) {
    await later.click();
    await sleep(300);
    return true;
  }
  return false;
}

const phone = (page) => page.locator('[data-screen-label="Phone"]');

/** The screen showing in the phone: Home, Invest, Asset detail, Buy amount, Buy review, Buy complete, ... */
async function screenName(page) {
  return page.evaluate(() => document.querySelector('[data-screen-label="Phone"] [data-screen-label]')?.getAttribute('data-screen-label') ?? document.querySelector('[data-screen-label]')?.getAttribute('data-screen-label') ?? null);
}

async function waitScreen(page, label, timeout = 15_000) {
  await page.waitForFunction((l) => document.querySelector('[data-screen-label="Phone"] [data-screen-label]')?.getAttribute('data-screen-label') === l, label, { timeout, polling: 100 });
}

const xq = (s) => (s.includes('"') ? `'${s}'` : `"${s}"`);

/**
 * A button in the side console, by its row title. Each row is [letter] [title + description] [button].
 * Several titles can be given: the visitor wording first, then the design's original wording.
 */
function consoleAction(page, titles) {
  const xp = titles.map((t) => `//div[not(*)][normalize-space(.)=${xq(t)}]/parent::div/following-sibling::*[1]`).join(' | ');
  return page.locator(`xpath=${xp}`).first();
}

const CONSOLE = {
  race1: ['Race 1: without Icarus', 'Without Icarus'],
  race2: ['Race 2: with Icarus', 'With Icarus'],
  say: ['No mic? Let Icarus hear it', 'Say “1,000 baht in gold”'],
  explain: ['Explain anything'],
  talk: ['Just talk'],
  guide: ['Step-by-step guide'],
  dashboard: ['Business dashboard'],
};

/**
 * The stopwatch card in the side console. Read by position, not by label (the labels have been reworded:
 * "A · Manual" became "Race 1 · by hand"): title, mode, time, then race 1 label and time, race 2 label and time.
 */
async function stopwatch(page) {
  return page.evaluate(() => {
    const head = [...document.querySelectorAll('div')].find((d) => d.childElementCount === 0 && (d.textContent ?? '').trim() === 'Stopwatch');
    const card = head?.parentElement?.parentElement;
    if (!card) return null;
    const lines = (card.innerText ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
    const ti = lines.findIndex((l) => /^\d+(\.\d+)?s$|^\d+m \d{2}s$/.test(l));
    const ratioEl = [...card.querySelectorAll('div')].find((d) => d.childElementCount === 0 && /faster/i.test(d.textContent ?? ''));
    const r = card.getBoundingClientRect();
    const rr = ratioEl?.getBoundingClientRect();
    return {
      mode: lines[1] ?? '',
      time: ti >= 0 ? lines[ti] : '',
      labels: ti >= 0 ? [lines[ti + 1] ?? '', lines[ti + 3] ?? ''] : [],
      a: ti >= 0 ? lines[ti + 2] ?? '' : '',
      b: ti >= 0 ? lines[ti + 4] ?? '' : '',
      ratio: ratioEl ? (ratioEl.textContent ?? '').trim() : '',
      cardTop: Math.round(r.top),
      cardBottom: Math.round(r.bottom),
      ratioInViewport: rr ? rr.top >= 0 && rr.bottom <= innerHeight && rr.left >= 0 && rr.right <= innerWidth : false,
      ratioTop: rr ? Math.round(rr.top) : null,
      viewportHeight: innerHeight,
    };
  });
}

/** The chat sheet: open or not, its messages, and the typing dots. Runs in the page. */
function chatStateInPage() {
  const input = [...document.querySelectorAll('input')].find((i) => (i.placeholder ?? '').startsWith('Ask Icarus'));
  const bubbleEl = document.querySelector('[data-screen-label="Phone"] div[style*="max-width: 250px"]');
  const fabBubble = bubbleEl ? (bubbleEl.innerText ?? '').trim() : '';
  if (!input) return { open: false, messages: [], typing: false, fabBubble };
  const cols = [...document.querySelectorAll('[data-screen-label="Phone"] div')].filter((d) => {
    const cs = getComputedStyle(d);
    return cs.overflowY === 'auto' && cs.flexDirection === 'column';
  });
  const list = cols.find((c) => [...c.children].some((ch) => ['flex-end', 'flex-start'].includes(getComputedStyle(ch).alignSelf)));
  const messages = [];
  let typing = false;
  for (const ch of list ? [...list.children] : []) {
    const align = getComputedStyle(ch).alignSelf;
    if (align === 'flex-end') {
      messages.push({ role: 'user', text: (ch.innerText ?? '').trim() });
    } else if (align === 'flex-start') {
      if (/icDot/.test(ch.innerHTML)) {
        typing = true;
        continue;
      }
      const bubble = [...ch.children].find((k) => getComputedStyle(k).backgroundColor === 'rgb(255, 247, 249)' && (k.innerText ?? '').trim());
      const lines = (ch.innerText ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
      const chips = [...ch.querySelectorAll('div')].filter((d) => d.childElementCount === 0 && getComputedStyle(d).borderTopColor === 'rgb(247, 210, 220)' && getComputedStyle(d).cursor === 'pointer').map((d) => (d.textContent ?? '').trim());
      messages.push({
        role: 'icarus',
        text: bubble ? (bubble.innerText ?? '').trim() : lines.filter((l) => l !== 'Icarus' && !/^\d:\d\d$/.test(l)).join(' '),
        sources: (lines.find((l) => l.startsWith('Based on:')) ?? '').replace(/^Based on:\s*/, ''),
        demo: lines.includes('Demo response'),
        chips,
      });
    }
  }
  return { open: true, messages, typing, fabBubble };
}

const chatState = (page) => page.evaluate(chatStateInPage);

/**
 * Open the chat the way a visitor does: the mascot button. It opens the VOICE window first (the design's default),
 * so typing needs "Aa" (Switch to chat). Returns how many taps it took and the way in.
 */
async function openChat(page) {
  const input = page.getByPlaceholder(INPUT_PLACEHOLDER);
  if (await input.isVisible().catch(() => false)) return { clicks: 0, via: 'already open' };
  const via = [];
  let clicks = 0;
  const fab = page.locator('[title="Talk to Icarus"]');
  if (await fab.isVisible().catch(() => false)) {
    await fab.click();
    clicks += 1;
    via.push('mascot button');
    await sleep(800);
  }
  if (!(await input.isVisible().catch(() => false))) {
    const aa = page.locator('[title="Switch to chat"]');
    if (await aa.isVisible().catch(() => false)) {
      await aa.click();
      clicks += 1;
      via.push('"Aa" (switch to chat)');
    }
  }
  await input.waitFor({ state: 'visible', timeout: 6000 });
  return { clicks, via: via.join(' > ') || 'none' };
}

/** The cards Icarus floats over the phone: chart or steps, U-Bot handoff, trade preview. */
async function cards(page) {
  return page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), inViewport: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth };
    };
    const info = document.getElementById('icarus-info-card');
    const hand = document.getElementById('icarus-handoff');
    const trade = document.getElementById('icarus-trade');
    const a = hand?.querySelector('a');
    return {
      info: info ? { label: info.getAttribute('aria-label'), kind: info.querySelector('svg[role="img"]') ? 'chart' : info.querySelector('ol') ? 'steps' : 'other', text: (info.innerText ?? '').slice(0, 600), box: box(info) } : null,
      handoff: hand ? {
        title: hand.getAttribute('aria-label'),
        prompt: (hand.querySelector('[data-testid="ubot-prompt"]')?.innerText ?? '').trim(),
        link: a ? { text: (a.textContent ?? '').trim(), href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') } : null,
        text: (hand.innerText ?? '').slice(0, 900),
        box: box(hand),
      } : null,
      trade: trade ? { label: trade.getAttribute('aria-label'), text: (trade.innerText ?? '').slice(0, 600), box: box(trade) } : null,
    };
  });
}

async function voiceDock(page) {
  return page.evaluate(() => {
    const d = document.querySelector('[data-ui-id="icarus.voice_dock"]');
    if (!d) return { visible: false, text: '' };
    const r = d.getBoundingClientRect();
    return { visible: r.width > 0 && getComputedStyle(d).opacity !== '0', text: (d.innerText ?? '').split('\n').map((s) => s.trim()).filter(Boolean).join(' | ') };
  });
}

/** The tour: playing or not, the "Tour" pill, the progress dots, what the mascot says. Runs in the page. */
function tourStateInPage() {
  const pill = document.querySelector('button[aria-label="Play the one-minute tour"]');
  const pillVisible = Boolean(pill) && getComputedStyle(pill).display !== 'none' && pill.getBoundingClientRect().width > 0;
  const skip = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Skip tour');
  const bar = skip?.parentElement ?? null;
  const barVisible = Boolean(bar) && getComputedStyle(bar).display !== 'none';
  const dots = bar ? [...bar.querySelectorAll('span > span')] : [];
  const bubble = document.querySelector('.ic-g-bubble');
  const ask = document.querySelector('.ic-g-ask');
  const visible = (el) => Boolean(el) && getComputedStyle(el).opacity !== '0' && getComputedStyle(el).display !== 'none';
  return {
    touring: document.body.classList.contains('ic-touring'),
    pillVisible,
    barVisible,
    done: dots.filter((d) => getComputedStyle(d).backgroundColor === 'rgb(201, 79, 114)').length,
    total: dots.length,
    bubble: visible(bubble) ? (bubble.textContent ?? '').trim() : '',
    ask: visible(ask) ? (ask.textContent ?? '').trim() : '',
    screen: document.querySelector('[data-screen-label="Phone"] [data-screen-label]')?.getAttribute('data-screen-label') ?? null,
  };
}

const tourState = (page) => page.evaluate(tourStateInPage);

/** label -> value pairs from a screen's text, for the buy screens ("Total" -> "฿1,000.00"). */
async function screenPairs(page, label) {
  return page.evaluate((l) => {
    const el = document.querySelector(`[data-screen-label="${l}"]`);
    if (!el) return null;
    const lines = (el.innerText ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
    const keys = ['Asset', 'Purchase amount', 'Estimated quantity', 'Transaction fee', 'Total', 'Pay from', 'Available balance', 'Balance after', 'Amount', 'Fee', 'Total paid', 'Status', 'Price', 'Amount in THB'];
    const out = { _lines: lines.slice(0, 40) };
    lines.forEach((line, i) => {
      const k = keys.find((key) => line === key || line.startsWith(`${key} (`));
      // the fee label carries a "?" help icon: the value is the next line that is not the icon
      const value = lines.slice(i + 1, i + 3).find((v) => v !== '?') ?? '';
      if (k && out[k] === undefined) out[k] = value;
    });
    return out;
  }, label);
}

module.exports = {
  INPUT_PLACEHOLDER, STARTER_CHIPS, CONSOLE, sleep,
  gotoApp, waitDemoAccount, introCard, dismissIntro, phone, screenName, waitScreen, consoleAction, stopwatch,
  chatState, chatStateInPage, openChat, cards, voiceDock, tourState, tourStateInPage, screenPairs,
};
