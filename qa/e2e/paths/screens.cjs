// P8. Every screen a visitor can reach, scanned for placeholders and inconsistencies (the scan also runs on every
// screenshot of the other paths). On a laptop it also tries the other side-console buttons once.

const app = require('../lib/app.cjs');

async function scrollPhone(page, where) {
  await page.evaluate((w) => {
    const sc = [...(document.querySelector('[data-screen-label="Phone"]')?.children ?? [])].find((c) => getComputedStyle(c).overflowY === 'auto');
    if (sc) sc.scrollTop = w === 'bottom' ? sc.scrollHeight : 0;
  }, where);
  await app.sleep(350);
}

async function nav(page, label) {
  await app.phone(page).getByText(label, { exact: true }).last().click({ timeout: 8000 });
  await app.sleep(500);
}

module.exports = {
  id: 'screens',
  grid: 'P8',
  title: 'Placeholder and consistency sweep of every screen',
  envs: ['chromium-laptop', 'webkit-phone'],
  async run({ page, run, base, env }) {
    const ph = app.phone(page);
    const visited = [];
    const visit = async (name, fn, opts = {}) => {
      await run.step(page, name, async () => {
        await fn();
        visited.push(name);
        if (opts.bottom) {
          await run.look(page, `${name} (top)`);
          await scrollPhone(page, 'bottom');
        }
      }, { critical: false });
      if (opts.bottom) await scrollPhone(page, 'top');
    };

    await run.step(page, 'Open the app and wait for the demo account', async () => {
      run.timing('app_ready_ms', await app.gotoApp(page, base));
      run.timing('demo_account_ms', await app.waitDemoAccount(page));
      await app.sleep(800);
      await app.dismissIntro(page);
      const home = await page.evaluate(() => (document.querySelector('[data-screen-label="Home"]')?.innerText ?? '').split('\n').slice(0, 4));
      run.data.homeHeader = home;
      const name = run.scanContext.displayName;
      if (name) run.check(`Home greets the backend's demo user (${name})`, home.join(' ').includes(name), home.join(' | '), 'soft');
    });

    await visit('Home', async () => {}, { bottom: true });
    await visit('Wallets', () => nav(page, 'Wallets'));
    await visit('Invest (All)', () => nav(page, 'Invest'), { bottom: true });
    for (const f of ['Crypto', 'Stocks', 'Gold']) {
      await visit(`Invest filter: ${f}`, async () => {
        await ph.getByText(f, { exact: true }).first().click({ timeout: 5000 });
        await app.sleep(400);
        const rows = await ph.locator('[data-ui-id^="invest.asset."]').count();
        run.data[`filter_${f}`] = rows;
        run.check(`Filter "${f}" lists at least one asset`, rows > 0, `${rows} rows`, 'soft');
      });
    }
    await visit('Back to All', async () => {
      await ph.getByText('All', { exact: true }).first().click({ timeout: 5000 });
      await app.sleep(300);
    });
    for (const id of ['XAU', 'BTC', 'ETH']) {
      await visit(`Asset detail: ${id}`, async () => {
        const row = ph.locator(`[data-ui-id="invest.asset.${id}"]`);
        if (!(await row.count())) throw new Error(`no ${id} row on Invest`);
        await row.click();
        await app.waitScreen(page, 'Asset detail', 5000);
      }, { bottom: true });
      if (id === 'XAU') {
        await visit('Buy amount (Gold)', async () => {
          await ph.locator('[data-ui-id="asset.buy_button"]').click({ timeout: 5000 });
          await app.waitScreen(page, 'Buy amount', 5000);
        });
        await visit('Buy amount with 1000 typed', async () => {
          await ph.locator('[data-ui-id="buy.amount_input"] input').fill('1000');
          await app.sleep(300);
          run.data.buyAmount = await app.screenPairs(page, 'Buy amount');
        });
        await run.step(page, 'Back to the asset, then Invest', async () => {
          await ph.locator('[data-screen-label="Buy amount"] > div:first-child > div:first-child').click({ timeout: 5000 });
          await app.waitScreen(page, 'Asset detail', 5000);
          await ph.locator('[data-screen-label="Asset detail"] > div:first-child > div:first-child').click({ timeout: 5000 });
          await app.waitScreen(page, 'Invest', 5000);
        }, { critical: false, screenshot: false });
      } else {
        await run.step(page, `Back to Invest from ${id}`, async () => {
          await ph.locator('[data-screen-label="Asset detail"] > div:first-child > div:first-child').click({ timeout: 5000 });
          await app.waitScreen(page, 'Invest', 5000);
        }, { critical: false, screenshot: false });
      }
    }
    await visit('Portfolio', async () => {
      await ph.getByText('Portfolio', { exact: true }).first().click({ timeout: 5000 });
      await app.waitScreen(page, 'Portfolio', 5000);
    }, { bottom: true });
    await visit('Payments', () => nav(page, 'Payments'), { bottom: true });
    await visit('Card', () => nav(page, 'Card'), { bottom: true });
    await visit('Chat (welcome message)', async () => {
      await nav(page, 'Home');
      const how = await app.openChat(page);
      run.data.chatOpenedWith = how.via;
      const st = await app.chatState(page);
      run.data.welcome = st.messages.find((m) => m.role === 'icarus')?.text ?? '';
    });
    await run.step(page, 'Close the chat', async () => {
      await page.locator('[data-screen-label="Phone"] div[style*="cursor: pointer"]:has(path[d="M18 6 6 18M6 6l12 12"])').first().click({ timeout: 5000 });
      await app.sleep(400);
    }, { critical: false, screenshot: false });

    if (env.kind === 'laptop') {
      await visit('Side console: "Explain anything" > Open', async () => {
        await app.consoleAction(page, app.CONSOLE.explain).click({ timeout: 8000 });
        await app.sleep(900);
        run.data.explainScreen = await app.screenName(page);
        run.check('"Explain anything" opens an asset page', run.data.explainScreen === 'Asset detail', run.data.explainScreen, 'soft');
      });
      await visit('Tap the chart, then "Ask Icarus"', async () => {
        await app.phone(page).locator('[data-ui-id="asset.chart"]').click({ timeout: 5000 });
        await app.sleep(400);
        const askBtn = app.phone(page).getByText('Ask Icarus', { exact: true });
        run.check('"Ask Icarus" appears when the chart is tapped', await askBtn.isVisible(), '', 'soft');
        if (!(await askBtn.isVisible())) return;
        await askBtn.click();
        const t0 = Date.now();
        let answer = null;
        while (Date.now() - t0 < 45_000) {
          const st = await app.chatState(page);
          const icarus = st.messages.filter((m) => m.role === 'icarus');
          if (icarus.length >= 2) {
            answer = icarus[icarus.length - 1];
            break;
          }
          await app.sleep(150);
        }
        run.data.explainAnswer = answer ? { ms: Date.now() - t0, text: answer.text, sources: answer.sources } : null;
        run.check('Chart explanation answered', Boolean(answer), answer ? `${((Date.now() - t0) / 1000).toFixed(1)} s: ${answer.text.slice(0, 140)}` : 'no answer in 45 s', 'soft');
        await app.sleep(1200);
      });
      await visit('Side console: "Step-by-step guide" > Run', async () => {
        await app.consoleAction(page, app.CONSOLE.guide).click({ timeout: 8000 });
        const t0 = Date.now();
        let seen = null;
        while (Date.now() - t0 < 45_000) {
          const s = await page.evaluate(() => ({
            guide: [...document.querySelectorAll('[data-screen-label="Phone"] div')].some((d) => d.childElementCount === 0 && /^Icarus guide · Step \d/.test((d.textContent ?? '').trim())),
            steps: Boolean(document.getElementById('icarus-info-card')?.querySelector('ol')),
          }));
          if (s.guide || s.steps) {
            seen = s.guide ? 'the on-screen guide (Step 1 of 5)' : 'a steps card';
            break;
          }
          await app.sleep(200);
        }
        run.data.guide = seen ? { ms: Date.now() - t0, shown: seen } : null;
        run.check('Step-by-step guide starts', Boolean(seen), seen ?? 'nothing in 45 s', 'soft');
        await app.sleep(1500);
      });
      await run.step(page, 'Exit the guide', async () => {
        const exit = app.phone(page).getByText('Exit guide', { exact: true });
        if (await exit.isVisible().catch(() => false)) await exit.click();
        const close = page.locator('#icarus-info-card button');
        if (await close.isVisible().catch(() => false)) await close.click();
        await app.sleep(400);
      }, { critical: false, screenshot: false });
      await visit('Side console: "Just talk" > Talk', async () => {
        await app.consoleAction(page, app.CONSOLE.talk).click({ timeout: 8000 });
        await app.sleep(1800);
        const dock = await app.voiceDock(page);
        run.data.justTalk = dock;
        run.check('"Just talk" opens the voice window', dock.visible, dock.text, 'soft');
        const end = page.locator('[title="End conversation"]');
        if (await end.isVisible().catch(() => false)) await end.click();
      });
    }
    run.data.visited = visited;
  },
};
