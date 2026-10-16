// P7. Phone: the tour starts, one typed question works, and what a phone visitor can and cannot reach.

const app = require('../lib/app.cjs');

/** Where things are on a phone screen. Runs in the page. */
function layoutInPage() {
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y + scrollY), w: Math.round(b.width), h: Math.round(b.height) };
  };
  const leaf = (text) => [...document.querySelectorAll('div,button,a')].find((d) => d.childElementCount === 0 && (d.textContent ?? '').trim() === text);
  return {
    viewport: { w: innerWidth, h: innerHeight },
    page: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight },
    phoneFrame: r(document.querySelector('[data-screen-label="Phone"]')?.parentElement),
    phoneScreen: r(document.querySelector('[data-screen-label="Phone"]')),
    mascotButton: r(document.querySelector('[title="Talk to Icarus"]')),
    tourPill: r(document.querySelector('button[aria-label="Play the one-minute tour"]')),
    sideConsole: r(leaf('Try Icarus yourself') ?? leaf('Icarus demo console')),
    race1: r(leaf('Race 1: without Icarus')),
    stopwatch: r(leaf('Stopwatch')),
    navBar: r(leaf('Home')),
  };
}

module.exports = {
  id: 'phone',
  grid: 'P7',
  title: 'Phone: tour starts, one typed question, what a phone visitor can reach',
  envs: ['chromium-phone', 'webkit-phone'],
  async run({ page, run, base }) {
    const can = [];
    const cannot = [];

    await run.step(page, 'Open the app on a phone', async () => {
      run.timing('app_ready_ms', await app.gotoApp(page, base));
      await app.sleep(1200);
      const L = await page.evaluate(layoutInPage);
      run.data.layout = L;
      const overflow = L.page.w - L.viewport.w;
      run.check('No sideways scrolling', overflow <= 1, `page is ${L.page.w}px wide on a ${L.viewport.w}px screen (${overflow}px sideways)`, 'soft');
      run.check('The phone mock fits the screen width', L.phoneFrame && L.phoneFrame.w <= L.viewport.w, `phone frame ${L.phoneFrame?.w}px on a ${L.viewport.w}px screen`, 'soft');
      const mascotVisible = L.mascotButton && L.mascotButton.y + L.mascotButton.h <= L.viewport.h;
      run.check('Icarus button visible without scrolling', mascotVisible, L.mascotButton ? `mascot button at y=${L.mascotButton.y}, screen height ${L.viewport.h}` : 'not found', 'soft');
      (mascotVisible ? can : cannot).push(mascotVisible ? 'see the Icarus button on first load' : `see the Icarus button without scrolling (it is at y=${L.mascotButton?.y} of a ${L.viewport.h}px screen; the 852px phone mock is taller than the phone)`);
      if (L.sideConsole) cannot.push(`see the race console without scrolling (it starts ${L.sideConsole.y}px down, below the phone mock)`);
    });

    await run.step(page, '"Meet Icarus" card fits the phone screen', async () => {
      const card = app.introCard(page);
      await card.waitFor({ state: 'visible', timeout: 8000 });
      const box = await card.boundingBox();
      const vp = page.viewportSize();
      const fits = box && box.y >= 0 && box.y + box.height <= vp.height + 1;
      run.check('"Meet Icarus" card fully on screen', fits, box ? `card ${Math.round(box.height)}px tall at y=${Math.round(box.y)} on a ${vp.height}px screen` : '', 'soft');
    });

    await run.step(page, 'Start the tour', async () => {
      await page.getByRole('button', { name: /Watch the 1-minute tour/ }).click();
      await page.waitForFunction(() => document.body.classList.contains('ic-touring'), null, { timeout: 6000 });
      run.check('Tour starts on a phone', true);
      can.push('watch the tour');
      await app.sleep(9000);
      const s = await app.tourState(page);
      run.data.tourAt9s = s;
      run.check('Tour is moving (progress after 9 s)', s.done >= 2, `step ${s.done} of ${s.total}, caption "${s.bubble.slice(0, 60)}"`, 'soft');
      const mascot = await page.evaluate(() => {
        const m = document.querySelector('.ic-g-mascot');
        if (!m) return null;
        const b = m.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), inViewport: b.right > 0 && b.left < innerWidth && b.bottom > 0 && b.top < innerHeight };
      });
      run.data.tourMascot = mascot;
      run.check('Tour mascot on screen', mascot?.inViewport, JSON.stringify(mascot), 'soft');
    });

    await run.step(page, 'Skip the tour', async () => {
      await page.getByRole('button', { name: 'Skip tour' }).click();
      await page.waitForFunction(() => !document.body.classList.contains('ic-touring'), null, { timeout: 10_000 });
      await app.sleep(1200);
      const s = await app.tourState(page);
      run.check('"Tour" pill back after skipping', s.pillVisible);
      const chat = await app.chatState(page);
      run.check('Chat open after the tour', chat.open, '', 'soft');
    });

    await run.step(page, 'Type one question: "How is gold doing?"', async () => {
      const how = await app.openChat(page);
      const before = (await app.chatState(page)).messages.filter((m) => m.role === 'icarus').length;
      const input = page.getByPlaceholder(app.INPUT_PLACEHOLDER);
      const box = await input.boundingBox();
      run.data.inputBox = box;
      await input.click();
      await input.fill('How is gold doing?');
      await app.sleep(120);
      const t0 = Date.now();
      await input.press('Enter');
      let answered = false;
      while (Date.now() - t0 < 45_000) {
        const st = await app.chatState(page);
        if (st.messages.filter((m) => m.role === 'icarus').length > before || (!st.open && st.fabBubble)) {
          answered = true;
          const last = [...st.messages].reverse().find((m) => m.role === 'icarus');
          run.data.answer = { ms: Date.now() - t0, text: last?.text ?? st.fabBubble, sources: last?.sources ?? '', via: how.via };
          break;
        }
        await app.sleep(100);
      }
      run.timing('question_ms', answered ? run.data.answer.ms : 45_000);
      run.check('Typed question answered on a phone', answered, answered ? `${(run.data.answer.ms / 1000).toFixed(1)} s: ${run.data.answer.text.slice(0, 120)}` : 'no answer in 45 s');
      (answered ? can : cannot).push(answered ? `type a question and get an answer (opened with: ${how.via})` : 'get an answer to a typed question');
      await app.sleep(1500);
      const vp = page.viewportSize();
      const after = await page.getByPlaceholder(app.INPUT_PLACEHOLDER).boundingBox();
      run.check('Answer and typing box fit on the phone screen together', after && after.y + after.height <= vp.height, after ? `typing box at y=${Math.round(after.y)} of ${vp.height}` : '', 'soft');
    });

    await run.step(page, 'Ask Icarus to buy, then tap Confirm purchase', async () => {
      await app.openChat(page);
      const input = page.getByPlaceholder(app.INPUT_PLACEHOLDER);
      await input.click();
      await input.fill('Put 1,000 baht in gold');
      await app.sleep(120);
      await input.press('Enter');
      await app.waitScreen(page, 'Buy review', 40_000);
      await app.sleep(2500); // the read-back
      await run.look(page, 'Icarus filled the buy screen');
      await app.phone(page).locator('[data-ui-id="buy.confirm_button"]').click({ timeout: 8000 });
      let done = true;
      try {
        await app.waitScreen(page, 'Buy complete', 8000);
      } catch {
        done = false;
      }
      run.data.buyByVoiceOnPhone = done;
      run.check('A purchase Icarus set up can be confirmed on a phone', done, done ? '' : `tapping Confirm purchase did nothing (still on ${await app.screenName(page)})`, 'soft');
      (done ? can : cannot).push(done ? 'buy gold through Icarus and confirm it' : 'confirm a purchase that Icarus set up (Confirm purchase does nothing)');
    }, { critical: false });

    await run.step(page, 'Find the race console and the stopwatch', async () => {
      const L = await page.evaluate(layoutInPage);
      const start = app.consoleAction(page, app.CONSOLE.race1);
      const reachable = await start.count();
      if (!reachable) {
        cannot.push('find the race console at all');
        run.check('Race console exists on a phone', false, 'not rendered', 'soft');
        return;
      }
      await start.scrollIntoViewIfNeeded();
      await app.sleep(300);
      await start.click();
      await app.sleep(800);
      const sw = await app.stopwatch(page);
      const L2 = await page.evaluate(layoutInPage);
      const scrolled = await page.evaluate(() => Math.round(scrollY));
      const phoneVisible = L2.phoneScreen && L2.phoneScreen.y + L2.phoneScreen.h > scrolled && L2.phoneScreen.y < scrolled + L2.viewport.h;
      run.data.race = { stopwatch: sw, scrolledTo: scrolled, phoneVisibleWhileOnConsole: phoneVisible, consoleTop: L.sideConsole?.y, stopwatchTop: L.stopwatch?.y };
      run.check('Race 1 can be started on a phone (after scrolling)', /running/i.test(sw?.mode ?? ''), `stopwatch ${sw?.mode}; scrolled ${scrolled}px down`, 'soft');
      can.push(`start Race 1 after scrolling about ${scrolled}px down`);
      if (!phoneVisible) cannot.push('see the app and the race buttons at the same time: after pressing Start the app is scrolled out of view');
      if (L.stopwatch && L.stopwatch.y > L.viewport.h) cannot.push(`watch the stopwatch while tapping through the app (stopwatch is ${L.stopwatch.y}px down, the app's Confirm button is near the top)`);
      await run.look(page, 'race console on a phone', { fullPage: false });
      // back to the top, as the visitor would
      await page.evaluate(() => window.scrollTo(0, 0));
    }, { critical: false });

    await run.step(page, 'Whole page on a phone', async () => {
      await run.shot(page, 'whole page on a phone', { fullPage: true });
    }, { critical: false, screenshot: false });

    run.data.can = can;
    run.data.cannot = cannot;
    run.note(`A phone visitor CAN: ${can.join('; ') || '-'}`);
    run.note(`A phone visitor CANNOT: ${cannot.join('; ') || '-'}`);
  },
};
