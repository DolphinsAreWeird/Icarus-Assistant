// Render docs/architecture.html to docs/media/architecture.png (2x). Needs Playwright with Chromium:
//   PLAYWRIGHT=/path/to/node_modules/playwright node docs/render-architecture.cjs
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1692, height: 760 }, deviceScaleFactor: 2 });
  await page.goto('file://' + path.join(__dirname, 'architecture.html'));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(__dirname, 'media', 'architecture.png') });
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
