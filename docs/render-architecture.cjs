// Render docs/architecture.html (2x): docs/media/architecture.png, the whole picture for the README, and
// docs/media/architecture-1/2/3.png, transparent layers the pitch deck reveals one after the other.
// Needs Playwright with Chromium:  PLAYWRIGHT=/path/to/node_modules/playwright node docs/render-architecture.cjs
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1692, height: 760 }, deviceScaleFactor: 2 });
  const file = 'file://' + path.join(__dirname, 'architecture.html');
  const shots = [['', 'architecture.png', false], ['?layer=1', 'architecture-1.png', true],
    ['?layer=2', 'architecture-2.png', true], ['?layer=3', 'architecture-3.png', true]];
  for (const [query, name, transparent] of shots) {
    await page.goto(file + query);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(__dirname, 'media', name), omitBackground: transparent });
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
