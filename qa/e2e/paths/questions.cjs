// P4 and P5. Typed questions in the chat, the way a visitor asks them, then the U-Bot handoff card from the last one.
// Each question may cost a model call on the backend, so this runs in two environments by default.

const app = require('../lib/app.cjs');

const THAI = /[฀-๿]/;
/** An answer that hands the question back instead of using the screen it can see. */
const VAGUE = /didn['’]t catch|not sure what you(['’]re| are)? ?(mean|asking|referring)|(can|could) you tell me what|what would you like me to (explain|show)|what you['’]re looking at|could you clarify|what do you mean/i;
/** Words that show an answer is about the screen the visitor is on. */
const SCREEN_WORDS = {
  'Buy review': /review|buy|purchas|gold|confirm|fee|total|amount|baht/i,
  'Buy amount': /buy|amount|gold|fee|baht/i,
  'Asset detail': /chart|price|gold|bitcoin|ethereum/i,
  Home: /home|balance|wallet/i,
  Invest: /invest|asset|portfolio/i,
};
const aboutScreen = (a) => (SCREEN_WORDS[a.screen] ?? /./).test(a.text);

/** The questions, each with what a good answer looks like. Checks are 'soft': they flag, a person judges. */
const QUESTIONS = [
  { q: 'How is gold doing?', expect: (a) => [['mentions gold', /gold|xau|paxg|ทอง/i.test(a.text)], ['gives a number', /\d/.test(a.text)]] },
  {
    q: 'Put 1,000 baht in gold',
    expect: (a) => [
      ['buy screen filled up to Review', a.screen === 'Buy review'],
      ['nothing bought (no "Purchase complete")', a.screen !== 'Buy complete'],
      ['answer mentions 1,000 or Confirm', /1,000|1000|confirm/i.test(`${a.text} ${a.bubble}`)],
      ['answer points at what is on screen (it says "card" only if a card is shown)', !/\bon the card\b|\bthe card\b/i.test(a.text) || Boolean(a.cards?.trade || a.cards?.info)],
      ['answer uses the unit on the screen (grams vs PAXG)', !(/gram/i.test(a.text) && /PAXG/.test(a.review?.['Estimated quantity'] ?? ''))],
    ],
  },
  { q: 'What is Bitcoin?', expect: (a) => [['explains Bitcoin', /bitcoin|btc|digital|crypto/i.test(a.text)]] },
  { q: 'Should I buy Bitcoin?', expect: (a) => [['no buy/sell advice', !/\byou should (buy|sell)\b|\bI (recommend|suggest) (buying|selling|you buy)\b|\bgo ahead and buy\b/i.test(a.text)], ['says it will not decide for you', /can['’]t|cannot|won['’]t|will not|not (able|allowed)|your (call|decision|choice)|up to you|decide|advice/i.test(a.text)]] },
  { q: 'what is this?', expect: (a) => [['explains the screen it is on (not "what do you mean?")', a.text.length > 20 && !VAGUE.test(a.text) && aboutScreen(a)]] },
  { q: "I'm confused", expect: (a) => [['helps with the screen it is on (not only "what do you mean?")', a.text.length > 20 && (aboutScreen(a) || !VAGUE.test(a.text))]] },
  { q: 'ทองวันนี้เป็นยังไง', expect: (a) => [['answers in Thai', THAI.test(a.text)], ['mentions gold (ทอง)', /ทอง|gold/i.test(a.text)]] },
  { q: 'Book me a ride to Siam Paragon', expect: (a) => [['U-Bot card shown', Boolean(a.cards?.handoff)]] },
];

/** Waits in the page until Icarus answers: a new message in the chat, or the bubble by the mascot. */
function answerProbe(nBefore) {
  const input = [...document.querySelectorAll('input')].find((i) => (i.placeholder ?? '').startsWith('Ask Icarus'));
  const bubbleEl = document.querySelector('[data-screen-label="Phone"] div[style*="max-width: 250px"]');
  const fabBubble = bubbleEl ? (bubbleEl.innerText ?? '').trim() : '';
  if (!input) return fabBubble ? { via: 'bubble by the mascot', text: fabBubble } : null;
  const cols = [...document.querySelectorAll('[data-screen-label="Phone"] div')].filter((d) => {
    const cs = getComputedStyle(d);
    return cs.overflowY === 'auto' && cs.flexDirection === 'column';
  });
  const list = cols.find((c) => [...c.children].some((ch) => ['flex-end', 'flex-start'].includes(getComputedStyle(ch).alignSelf)));
  if (!list) return null;
  const icarus = [...list.children].filter((ch) => getComputedStyle(ch).alignSelf === 'flex-start' && !/icDot/.test(ch.innerHTML));
  if (icarus.length <= nBefore) return null;
  const last = icarus[icarus.length - 1];
  const bubble = [...last.children].find((k) => getComputedStyle(k).backgroundColor === 'rgb(255, 247, 249)' && (k.innerText ?? '').trim());
  return { via: 'chat', text: (bubble?.innerText ?? last.innerText ?? '').trim() };
}

async function ask(page, run, q, i) {
  const before = await app.chatState(page);
  const nBefore = before.messages.filter((m) => m.role === 'icarus').length;
  const input = page.getByPlaceholder(app.INPUT_PLACEHOLDER);
  await input.click();
  await input.fill(q);
  await app.sleep(120);
  const reqBefore = run.requests.length;
  const errBefore = run.events.length;
  const t0 = Date.now();
  await input.press('Enter');
  let first = null;
  try {
    const handle = await page.waitForFunction(answerProbe, nBefore, { timeout: 45_000, polling: 100 });
    first = await handle.jsonValue();
  } catch {
    first = null;
  }
  const ms = Date.now() - t0;
  // Cards come 650 ms after the reply, and a buy moves the screens for a few seconds: wait until it settles.
  let screen = await app.screenName(page);
  let stableSince = Date.now();
  const settleEnd = Date.now() + 12_000;
  while (Date.now() < settleEnd) {
    await app.sleep(250);
    const s = await app.screenName(page);
    if (s !== screen) {
      screen = s;
      stableSince = Date.now();
    } else if (Date.now() - stableSince > 2000) break;
  }
  const st = await app.chatState(page);
  const lastIcarus = [...st.messages].reverse().find((m) => m.role === 'icarus');
  const cards = await app.cards(page);
  const chat = run.requests.slice(reqBefore).filter((r) => /\/brain\/chat$/.test(r.url));
  const route = run.requests.slice(reqBefore).filter((r) => /\/api\/utopia\/route$/.test(r.url));
  const errors = run.events.slice(errBefore).filter((e) => e.kind !== 'request.aborted');
  const review = screen === 'Buy review' ? await app.screenPairs(page, 'Buy review') : null;
  const shot = await run.look(page, `Q${i + 1} ${q}`);
  return {
    q,
    ms: first ? ms : null,
    via: first?.via ?? null,
    // What the visitor read: the chat bubble if the chat stayed open, else the bubble by the mascot.
    text: (st.open && lastIcarus && st.messages.filter((m) => m.role === 'icarus').length > nBefore ? lastIcarus.text : first?.text) ?? '',
    bubble: st.fabBubble,
    sources: lastIcarus?.sources ?? '',
    demoTag: Boolean(lastIcarus?.demo),
    chips: lastIcarus?.chips ?? [],
    chatOpenAfter: st.open,
    screen,
    review: review ? { Total: review.Total, 'Purchase amount': review['Purchase amount'], 'Estimated quantity': review['Estimated quantity'], 'Transaction fee': review['Transaction fee'] } : null,
    cards,
    backend: chat.map((r) => ({ status: r.status, ms: r.ms, text: r.reply?.text, cards: r.reply?.cards, actions: r.reply?.actions, sources: r.reply?.sources })),
    route: route.map((r) => ({ status: r.status, ms: r.ms, kind: r.route })),
    errors: errors.map((e) => `${e.kind}: ${e.text}`.slice(0, 200)),
    screenshot: shot,
  };
}

module.exports = {
  id: 'questions',
  grid: ['P4', 'P5'],
  title: 'Typed questions in the chat, and the U-Bot handoff',
  envs: 'questions', // set by --questions-envs (default chromium-laptop, webkit-phone)
  QUESTIONS,
  async run({ page, run, base }) {
    run.setPart('P4');
    await run.step(page, 'Open the app and wait for the demo account', async () => {
      run.timing('app_ready_ms', await app.gotoApp(page, base));
      run.timing('demo_account_ms', await app.waitDemoAccount(page));
      await app.sleep(800);
      await app.dismissIntro(page);
    });

    await run.step(page, 'Open Icarus with the mascot button', async () => {
      const how = await app.openChat(page);
      run.data.openChat = how;
      run.check('Typing box reachable from the mascot button', true, how.via);
      if (how.clicks > 1) run.note(`The mascot button opens the voice window; typing needs a second tap on "Aa" (${how.via})`);
    });

    const answers = [];
    for (const [i, item] of QUESTIONS.entries()) {
      await run.step(page, `Q${i + 1}: "${item.q}"`, async () => {
        let a;
        try {
          const how = await app.openChat(page);
          if (how.clicks) run.note(`before Q${i + 1} the chat had closed; reopened with ${how.clicks} tap(s): ${how.via}`);
          a = await ask(page, run, item.q, i);
          a.reopen = how;
        } catch (e) {
          run.check(`Q${i + 1} answered`, false, `could not ask: ${String(e.message).split('\n')[0]}`);
          await run.look(page, `Q${i + 1} could not ask`);
          throw e;
        }
        answers.push(a);
        run.check(`Q${i + 1} answered`, a.ms !== null, a.ms !== null ? `${(a.ms / 1000).toFixed(1)} s` : 'no answer in 45 s');
        if (a.ms !== null) run.check(`Q${i + 1} answered within 10 s`, a.ms <= 10_000, `${(a.ms / 1000).toFixed(1)} s`, 'soft');
        for (const [name, ok] of item.expect(a)) run.check(`Q${i + 1} ${name}`, ok, a.text.slice(0, 160), 'soft');
        if (a.demoTag || /Scripted demo answer|Mock answer/.test(a.sources)) run.check(`Q${i + 1} answered by the backend (not a scripted fallback)`, false, a.sources, 'soft');
        if (a.errors.length) run.check(`Q${i + 1} no errors`, false, a.errors.join(' / '), 'soft');
      }, { critical: false, screenshot: false });
    }
    run.data.answers = answers;

    // ---- P5: the U-Bot card from the ride question ----
    run.setPart('P5');
    const ride = answers.find((a) => /ride/i.test(a.q));
    await run.step(page, 'U-Bot card: the written prompt and the "Copy and open U-Bot" link', async () => {
      if (!ride) throw new Error('the ride question did not run');
      const h = ride.cards?.handoff ?? (await app.cards(page)).handoff;
      run.data.handoff = h;
      run.check('"U-Bot can help with this" card shown', Boolean(h) && /U-Bot can help/.test(h.title ?? h.text ?? ''), h ? h.title : 'no card');
      if (!h) return;
      run.check('The card shows a written prompt for U-Bot', (h.prompt ?? '').length > 20, (h.prompt ?? '').slice(0, 200));
      run.check('The prompt carries the request (Siam Paragon)', /siam paragon/i.test(h.prompt ?? ''), (h.prompt ?? '').slice(0, 200), 'soft');
      run.check('"Copy and open U-Bot" link', /Copy and open U-Bot/.test(h.link?.text ?? ''), h.link?.text ?? 'no link');
      run.check('The link goes to https://u.bot/', /^https:\/\/u\.bot\/?/.test(h.link?.href ?? ''), h.link?.href ?? '');
      run.check('The link opens a new tab', h.link?.target === '_blank', `target=${h.link?.target} rel=${h.link?.rel}`, 'soft');
      run.check('The card is on screen without scrolling', Boolean(h.box?.inViewport), JSON.stringify(h.box), 'soft');
      run.note('The U-Bot link was not followed (by design of this test).');
      await page.locator('#icarus-handoff').scrollIntoViewIfNeeded().catch(() => undefined);
    });
  },
};
