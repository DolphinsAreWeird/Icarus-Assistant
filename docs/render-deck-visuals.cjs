// Render the deck's charts and ecosystem map (docs/deck-visuals.html) to transparent PNGs in docs/media/deck/.
// Needs Playwright with Chromium:  PLAYWRIGHT=/path/to/node_modules/playwright node docs/render-deck-visuals.cjs
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

(async () => {
  const out = path.join(__dirname, 'media', 'deck');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1700, height: 1200 }, deviceScaleFactor: 2 });
  const file = 'file://' + path.join(__dirname, 'deck-visuals.html');
  const shot = async (query, id, name) => {
    await page.goto(file + query);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await page.locator('#' + id).screenshot({ path: path.join(out, name), omitBackground: true });
  };
  await shot('', 'speed', 'speed.png');
  await shot('', 'value', 'value.png');
  await shot('', 'margin', 'margin.png');
  for (const n of [1, 2, 3]) await shot(`?eco=${n}`, 'eco', `ecosystem-${n}.png`);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
