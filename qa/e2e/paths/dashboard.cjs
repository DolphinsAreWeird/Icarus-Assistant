// P6. The Business dashboard: /app/?page=dashboard loads with no errors; on a laptop also from the side console.

const app = require('../lib/app.cjs');

module.exports = {
  id: 'dashboard',
  grid: 'P6',
  title: 'Business dashboard loads with no errors',
  envs: ['chromium-laptop', 'chromium-phone', 'webkit-laptop', 'webkit-phone'],
  async run({ page, run, base, env }) {
    await run.step(page, 'Open /app/?page=dashboard', async () => {
      const t0 = Date.now();
      await page.goto(`${base}?page=dashboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.getByText('Icarus Insights').first().waitFor({ state: 'visible', timeout: 15_000 });
      run.timing('dashboard_ready_ms', Date.now() - t0);
      await app.sleep(1500);
      const info = await page.evaluate(() => ({
        kpis: [...document.querySelectorAll('[data-screen-label="Dashboard"] div')].filter((d) => d.childElementCount === 0 && /^\d[\d,]*$/.test((d.textContent ?? '').trim())).length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        text: (document.body.innerText ?? '').length,
      }));
      run.data.dashboard = info;
      run.check('Dashboard shows its numbers', info.kpis >= 4, `${info.kpis} number tiles`);
      run.check('No sideways scrolling', info.overflow <= 1, `${info.overflow}px wider than the screen`, 'soft');
    });

    await run.step(page, 'Dashboard, full page', async () => {
      await run.look(page, 'dashboard full page', { fullPage: true });
      const errors = run.events.filter((e) => e.kind === 'pageerror' || e.kind === 'console.error' || e.kind === 'request.failed' || (e.kind === 'http' && e.status >= 400));
      run.check('No errors while loading the dashboard', errors.length === 0, errors.map((e) => e.text).join(' / ').slice(0, 400));
    }, { screenshot: false });

    if (env.kind === 'laptop') {
      await run.step(page, 'From the app: side console "Business dashboard" > Open', async () => {
        await app.gotoApp(page, base);
        await app.sleep(800);
        await app.dismissIntro(page);
        const open = app.consoleAction(page, app.CONSOLE.dashboard);
        await open.click({ timeout: 8000 });
        await page.getByText('Icarus Insights').first().waitFor({ state: 'visible', timeout: 15_000 });
        run.check('Console link opens the dashboard', /page=dashboard/.test(page.url()), page.url());
      }, { critical: false });

      await run.step(page, 'Back to the app from the dashboard', async () => {
        await page.getByText('← App prototype').first().click({ timeout: 8000 });
        await page.waitForFunction(() => Boolean(window.Icarus), null, { timeout: 15_000 });
        run.check('"← App prototype" returns to the app', true, page.url());
        // let the demo account load, so the scan sees the app as a visitor does after a moment
        await app.waitDemoAccount(page).catch(() => run.note('the demo account did not load within 20 s after coming back'));
        await app.sleep(500);
      }, { critical: false });
    }
  },
};
