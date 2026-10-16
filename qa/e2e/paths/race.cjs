// P2 and P3. The race, in one page (the stopwatch compares the two runs only within one page):
//   P2 Race 1 by hand: Start, then tap through Invest > Gold > Buy > 1000 > (THB wallet) > Review > Confirm.
//   P3 Race 2 with Icarus: Start, "No mic? Let Icarus hear it" (Say), Icarus fills the buy screen, Confirm.
// Then the Business dashboard should show both times in "This demo session".

const app = require('../lib/app.cjs');

const PURCHASE_AMOUNT = '1000';

module.exports = {
  id: 'race',
  grid: ['P2', 'P3'],
  title: 'Race 1 by hand, then Race 2 with Icarus (stopwatch)',
  envs: ['chromium-laptop', 'webkit-laptop'],
  async run({ page, run, base }) {
    const ph = app.phone(page);
    let clicks = 0;
    const click = async (locator, what) => {
      await locator.click({ timeout: 8000 });
      clicks += 1;
      run.note(`tap ${clicks}: ${what}`);
    };

    run.setPart('P2');
    await run.step(page, 'Open the app and wait for the demo account', async () => {
      run.timing('app_ready_ms', await app.gotoApp(page, base));
      run.timing('demo_account_ms', await app.waitDemoAccount(page));
      await app.sleep(800);
      run.check('"Meet Icarus" card shown first', await app.introCard(page).isVisible(), '', 'info');
      await app.dismissIntro(page);
    });

    let raceStart = 0;
    await run.step(page, 'Race 1: press Start', async () => {
      const start = app.consoleAction(page, app.CONSOLE.race1);
      await start.waitFor({ state: 'visible', timeout: 5000 });
      await start.click();
      raceStart = Date.now();
      await app.sleep(400);
      const sw = await app.stopwatch(page);
      run.data.race1Start = sw;
      run.check('Stopwatch is running after Start', /running/i.test(sw?.mode ?? ''), `stopwatch: ${sw?.mode} ${sw?.time}`);
      run.check('App reset to Home', (await app.screenName(page)) === 'Home', await app.screenName(page), 'soft');
      run.check('Stopwatch visible on screen while racing', sw && sw.cardTop < sw.viewportHeight, sw ? `stopwatch card top at y=${sw.cardTop}, viewport ${sw.viewportHeight}` : '', 'soft');
    });

    await run.step(page, 'Tap the Invest tab', async () => {
      await click(ph.getByText('Invest', { exact: true }).last(), 'Invest tab');
      await app.waitScreen(page, 'Invest', 5000);
    });

    await run.step(page, 'Tap Gold in Explore Assets', async () => {
      const row = ph.locator('[data-ui-id="invest.asset.XAU"]');
      await row.waitFor({ state: 'visible', timeout: 5000 });
      const rowText = (await row.innerText()).split('\n').map((s) => s.trim()).filter(Boolean);
      const goldChips = await ph.getByText('Gold', { exact: true }).count();
      run.data.goldRow = rowText;
      if (goldChips > 1) run.note(`"Gold" appears ${goldChips} times on Invest (the filter chip and the asset row): a first-time user may tap the filter first`);
      await click(row, `asset row "${rowText.slice(0, 2).join(' / ')}"`);
      await app.waitScreen(page, 'Asset detail', 5000);
      const title = await page.evaluate(() => {
        const el = document.querySelector('[data-screen-label="Asset detail"]');
        return (el?.innerText ?? '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 4);
      });
      run.data.goldDetailTop = title;
      // row: [monogram, name, ticker, price, change]; detail: [title, monogram, name, "ticker · type"]
      const listName = rowText[1];
      if (listName && title[0] && listName !== title[0]) run.note(`The asset list says "${listName}" but its page says "${title[0]}"`);
    });

    await run.step(page, 'Tap Buy', async () => {
      await click(ph.locator('[data-ui-id="asset.buy_button"]'), 'Buy');
      await app.waitScreen(page, 'Buy amount', 5000);
    });

    await run.step(page, `Type ${PURCHASE_AMOUNT} as the amount`, async () => {
      const input = ph.locator('[data-ui-id="buy.amount_input"] input');
      await click(input, 'amount field');
      await input.pressSequentially(PURCHASE_AMOUNT, { delay: 70 });
      await app.sleep(300);
      run.data.buyAmountScreen = await app.screenPairs(page, 'Buy amount');
      run.check('Amount field shows 1000', (await input.inputValue()) === PURCHASE_AMOUNT, await input.inputValue());
    });

    await run.step(page, 'Pay with the THB wallet', async () => {
      const opts = await page.evaluate(() => {
        const el = document.querySelector('[data-screen-label="Buy amount"]');
        const rows = [...(el?.querySelectorAll('div') ?? [])].filter((d) => /Wallet$/.test((d.childElementCount === 0 ? d.textContent : '') ?? ''));
        return rows.map((r) => {
          const option = r.parentElement?.parentElement;
          return { name: (r.textContent ?? '').trim(), selected: option ? getComputedStyle(option).borderTopColor === 'rgb(201, 79, 114)' : null };
        });
      });
      run.data.walletOptions = opts;
      const thb = opts.find((o) => o.name === 'THB Wallet');
      run.check('THB Wallet offered', Boolean(thb), JSON.stringify(opts));
      if (thb && !thb.selected) await click(ph.getByText('THB Wallet', { exact: true }), 'THB Wallet');
      else run.note('THB Wallet already selected (no tap needed)');
    });

    await run.step(page, 'Tap Review purchase', async () => {
      await click(ph.locator('[data-ui-id="buy.review_button"]'), 'Review purchase');
      await app.waitScreen(page, 'Buy review', 15_000);
      const review = await app.screenPairs(page, 'Buy review');
      run.data.race1Review = review;
      run.check('Review shows a total of ฿1,000.00', /1,000\.00/.test(review?.Total ?? ''), `Total ${review?.Total}; amount ${review?.['Purchase amount']}; fee ${review?.['Transaction fee']}`, 'soft');
      if (review && review['Purchase amount'] && !/1,000/.test(review['Purchase amount'])) run.note(`Asked for ฿1,000 of gold: the review buys ${review['Purchase amount']} of gold plus ${review['Transaction fee']} fee (total ${review.Total})`);
    });

    await run.step(page, 'Tap Confirm purchase', async () => {
      const confirm = ph.locator('[data-ui-id="buy.confirm_button"]');
      run.data.race1ConfirmLabel = (await confirm.innerText()).trim();
      await click(confirm, 'Confirm purchase');
      const tConfirm = Date.now();
      await app.waitScreen(page, 'Buy complete', 15_000);
      run.timing('race1_confirm_to_complete_ms', Date.now() - tConfirm);
      run.timing('race1_measured_ms', Date.now() - raceStart);
      run.data.race1Done = await app.screenPairs(page, 'Buy complete');
    });

    await run.step(page, 'Race 1: stopwatch stopped and shows a time', async () => {
      await app.sleep(500);
      const sw = await app.stopwatch(page);
      run.data.race1Stopwatch = sw;
      run.data.race1Clicks = clicks;
      run.check('Stopwatch stopped (Idle)', !/running/i.test(sw?.mode ?? 'running'), `mode: ${sw?.mode}`);
      run.check('A · Manual shows a time', /\d/.test(sw?.a ?? ''), `A = ${sw?.a}`);
      run.note(`Race 1 took ${clicks} taps after Start; stopwatch A = ${sw?.a}`);
    });

    // ---------------- Race 2 ----------------
    run.setPart('P3');
    let race2Start = 0;
    await run.step(page, 'Race 2: press Start', async () => {
      const start = app.consoleAction(page, app.CONSOLE.race2);
      await start.click({ timeout: 8000 });
      race2Start = Date.now();
      await app.sleep(1500);
      const sw = await app.stopwatch(page);
      const dock = await app.voiceDock(page);
      run.data.race2Start = { stopwatch: sw, dock };
      run.check('Stopwatch is running after Start', /running/i.test(sw?.mode ?? ''), `stopwatch: ${sw?.mode}`);
      run.check('Voice window opens', dock.visible, dock.text, 'soft');
    });

    let sayAt = 0;
    await run.step(page, 'Press "No mic? Let Icarus hear it" (Say)', async () => {
      const say = app.consoleAction(page, app.CONSOLE.say);
      await say.click({ timeout: 8000 });
      sayAt = Date.now();
      // the voice window shows what Icarus "heard" and what it says; keep the lines as they change
      const said = [];
      const end = Date.now() + 45_000;
      let screen = null;
      while (Date.now() < end) {
        const dock = await app.voiceDock(page);
        if (dock.text && said[said.length - 1] !== dock.text) said.push(dock.text);
        screen = await app.screenName(page);
        if (screen === 'Buy review') break;
        await app.sleep(150);
      }
      run.data.race2Voice = said.slice(-6);
      run.timing('race2_say_to_review_ms', Date.now() - sayAt);
      run.check('Icarus filled the buy screen up to Review', screen === 'Buy review', `screen: ${screen}`);
      await app.sleep(1200); // let the read-back finish
    });

    await run.step(page, 'Check what Icarus set up', async () => {
      const review = await app.screenPairs(page, 'Buy review');
      run.data.race2Review = review;
      run.check('Review total is ฿1,000.00', /1,000\.00/.test(review?.Total ?? ''), `Total ${review?.Total}`, 'soft');
      const dock = await app.voiceDock(page);
      run.data.race2Readback = dock.text;
      run.check('Nothing bought before the tap (still on Review)', (await app.screenName(page)) === 'Buy review');
    });

    await run.step(page, 'Tap Confirm purchase', async () => {
      const eventsBefore = run.events.length;
      const infoBefore = run.appInfo.length;
      await ph.locator('[data-ui-id="buy.confirm_button"]').click({ timeout: 8000 });
      let completed = true;
      try {
        await app.waitScreen(page, 'Buy complete', 8000);
      } catch {
        completed = false;
      }
      const said = [...run.events.slice(eventsBefore).map((e) => e.text), ...run.appInfo.slice(infoBefore).map((e) => e.text)].filter((t) => /icarus/i.test(t));
      run.check('Confirm purchase completes the purchase Icarus set up', completed, completed ? '' : `still on "${await app.screenName(page)}" 8 s after the tap; nothing visible happened. App console: ${said.join(' / ') || '(nothing)'}`);
      if (!completed) {
        // What a visitor might try: close the voice window (it covers the back arrow), go back, Review purchase
        // again, Confirm again.
        await run.look(page, 'Confirm did nothing');
        let extra = 0;
        try {
          const end = page.locator('[title="End conversation"]');
          if (await end.isVisible().catch(() => false)) {
            await end.click();
            extra += 1;
            await app.sleep(400);
          }
          await ph.locator('[data-screen-label="Buy review"] > div:first-child > div:first-child').click({ timeout: 5000 });
          extra += 1;
          await app.waitScreen(page, 'Buy amount', 5000);
          await ph.locator('[data-ui-id="buy.review_button"]').click({ timeout: 5000 });
          extra += 1;
          await app.waitScreen(page, 'Buy review', 15_000);
          await ph.locator('[data-ui-id="buy.confirm_button"]').click({ timeout: 5000 });
          extra += 1;
          await app.waitScreen(page, 'Buy complete', 15_000);
          run.data.race2Workaround = { worked: true, extraTaps: extra };
          run.note(`Workaround: close the voice window, back, Review purchase, Confirm purchase (${extra} more taps) completed the purchase`);
        } catch (e) {
          run.data.race2Workaround = { worked: false, extraTaps: extra, error: String(e.message).split('\n')[0] };
          throw new Error(`Confirm did nothing, and back > Review > Confirm did not work either (${String(e.message).split('\n')[0]})`);
        }
      }
      run.timing('race2_measured_ms', Date.now() - race2Start);
    });

    await run.step(page, 'Stopwatch shows both times and the comparison', async () => {
      await app.sleep(600);
      const sw = await app.stopwatch(page);
      run.data.race2Stopwatch = sw;
      run.check('B · With Icarus shows a time', /\d/.test(sw?.b ?? ''), `B = ${sw?.b}`);
      run.check('A and B both shown', /\d/.test(sw?.a ?? '') && /\d/.test(sw?.b ?? ''), `A = ${sw?.a}, B = ${sw?.b}`, 'soft');
      run.check('Comparison line shown ("... faster")', Boolean(sw?.ratio), sw?.ratio || '(none)', 'soft');
      run.check('Comparison visible without scrolling', Boolean(sw?.ratioInViewport), sw?.ratioTop != null ? `comparison at y=${sw.ratioTop}, viewport ${sw.viewportHeight}` : 'not shown', 'soft');
      run.note(`Stopwatch: A = ${sw?.a}, B = ${sw?.b}, "${sw?.ratio}"`);
    });

    await run.step(page, 'Business dashboard shows this session\'s race times', async () => {
      await app.consoleAction(page, app.CONSOLE.dashboard).click({ timeout: 8000 });
      await page.getByText('Icarus Insights').first().waitFor({ state: 'visible', timeout: 15_000 });
      await app.sleep(1800); // the dashboard reads the session every 1.5 s
      const live = await page.evaluate(() => {
        const lines = (document.body.innerText ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
        const at = (k) => {
          const i = lines.indexOf(k);
          return i >= 0 ? lines[i + 1] ?? '' : null;
        };
        return { a: at('Scenario A time'), b: at('Scenario B time'), purchases: at('Purchases (simulated)'), questions: at('Questions to Icarus') };
      });
      run.data.dashboardLive = live;
      run.check('Dashboard lists both race times', /\d/.test(live.a ?? '') && /\d/.test(live.b ?? ''), JSON.stringify(live), 'soft');
      run.check('Dashboard counts the two purchases just made', Number(live.purchases) >= 2, `"Purchases (simulated)" shows ${live.purchases}`, 'soft');
    }, { critical: false });
  },
};
