// Browsers and screen sizes the suite runs in, and where to find Playwright.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/** The four environments: two engines, laptop and phone. */
const ENVIRONMENTS = {
  'chromium-laptop': { browser: 'chromium', kind: 'laptop', label: 'Chromium 1440x900', viewport: { width: 1440, height: 900 } },
  'chromium-phone': { browser: 'chromium', kind: 'phone', label: 'Chromium, Pixel 7', device: 'Pixel 7' },
  'webkit-laptop': { browser: 'webkit', kind: 'laptop', label: 'WebKit 1440x900', viewport: { width: 1440, height: 900 } },
  'webkit-phone': { browser: 'webkit', kind: 'phone', label: 'WebKit, iPhone 14', device: 'iPhone 14' },
};

/**
 * Playwright: --playwright <dir>, then $PLAYWRIGHT_PATH, then a normal require, then the copies in the npx cache
 * (~/.npm/_npx/<hash>/node_modules/playwright), newest first. A copy only counts if its Chromium and WebKit are
 * installed: an npx cache can hold an older Playwright whose browsers are gone.
 */
function loadPlaywright(explicit) {
  const candidates = [];
  if (explicit) candidates.push(path.resolve(explicit));
  if (process.env.PLAYWRIGHT_PATH) candidates.push(path.resolve(process.env.PLAYWRIGHT_PATH));
  candidates.push('playwright');
  const npx = path.join(os.homedir(), '.npm', '_npx');
  if (fs.existsSync(npx)) {
    const found = fs.readdirSync(npx)
      .map((dir) => path.join(npx, dir, 'node_modules', 'playwright'))
      .filter((dir) => fs.existsSync(path.join(dir, 'package.json')))
      .map((dir) => ({ dir, version: JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version ?? '0' }))
      .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
    candidates.push(...found.map((f) => f.dir));
  }
  const tried = [];
  for (const id of candidates) {
    let pw;
    try {
      pw = require(id);
    } catch {
      tried.push(`${id} (not installed)`);
      continue;
    }
    const missing = ['chromium', 'webkit'].filter((b) => {
      try {
        return !fs.existsSync(pw[b].executablePath());
      } catch {
        return true;
      }
    });
    if (!missing.length) return pw;
    tried.push(`${id} (browsers missing: ${missing.join(', ')})`);
  }
  throw new Error(`No usable Playwright (tried ${tried.join('; ')}). Install it (npm i -D playwright && npx playwright install chromium webkit) or pass --playwright <dir>.`);
}

/** Options for browser.newContext(): the device or viewport, a Bangkok judge, no microphone, and a video. */
function contextOptions(pw, env, videoDir) {
  let base;
  if (env.device) {
    const d = pw.devices[env.device];
    if (!d) throw new Error(`Playwright has no device called ${env.device}`);
    const { defaultBrowserType: _ignored, ...rest } = d;
    base = rest;
  } else {
    base = { viewport: env.viewport };
  }
  const size = base.viewport;
  return {
    ...base,
    locale: 'en-US',
    timezoneId: 'Asia/Bangkok',
    // No microphone permission: headless has no mic, and judges without one use "No mic? Let Icarus hear it".
    ...(videoDir ? { recordVideo: { dir: videoDir, size: { width: size.width, height: size.height } } } : {}),
  };
}

module.exports = { ENVIRONMENTS, loadPlaywright, contextOptions };
