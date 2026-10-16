// What was tested: the git commit and local changes, the built app, and what the servers say about themselves.
// The app is being edited while the suite runs, so every result is tied to this fingerprint.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');

function git(args) {
  try {
    // trimEnd only: `git status --porcelain` lines start with a space that is part of the format
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trimEnd();
  } catch {
    return '';
  }
}

function fileInfo(rel) {
  const file = path.join(REPO, rel);
  try {
    const st = fs.statSync(file);
    const sha = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 12);
    return { file: rel, modified: st.mtime.toISOString(), sha1: sha, bytes: st.size };
  } catch {
    return { file: rel, missing: true };
  }
}

async function getJson(url, timeoutMs = 8000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return await res.json();
  } catch (e) {
    return { error: String(e.message ?? e) };
  }
}

/** The fingerprint, plus what the scan needs to know (live prices, the demo user's name, the fee rule). */
async function buildInfo(base) {
  const origin = new URL(base).origin;
  const health = await getJson(`${origin}/api/health`);
  const brain = typeof health?.backend === 'string' ? await getJson(`${origin}${health.backend}/health`) : { error: 'no backend announced by /api/health' };
  // One probe account on the backend, to read the demo user's name and the fee rule (the app makes one per visitor).
  const probe = typeof health?.backend === 'string' ? await getJson(`${origin}${health.backend}/demo/state/u_new-qaprobe0001`) : null;
  const prices = brain && typeof brain.prices === 'object' ? brain.prices : {};
  const info = {
    repo: REPO,
    git: {
      head: git(['rev-parse', '--short', 'HEAD']),
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
      subject: git(['log', '-1', '--format=%s']),
      dirty: git(['status', '--porcelain']).split('\n').filter(Boolean),
    },
    dist: [fileInfo('frontend/dist/app.js'), fileInfo('frontend/dist/prototype/Icarus Prototype.dc.html'), fileInfo('frontend/dist/prototype/Icarus Business Dashboard.dc.html')],
    servers: {
      voice: health,
      backend: brain && !brain.error ? { engine: brain.engine, assistant: brain.assistant, offline: brain.offline, prices: brain.prices, fx: brain.fx } : brain,
    },
    demoAccount: probe && !probe.error ? { display_name: probe.display_name, currency: probe.currency, cash_thb: probe.cash_thb, fees: probe.fees, notice: probe.notice } : probe,
  };
  const scanContext = {
    pricesLive: Object.values(prices).some((v) => v === 'live'),
    displayName: probe?.display_name ?? null,
    feePct: typeof probe?.fees?.trading_fee_pct === 'number' ? probe.fees.trading_fee_pct : null,
    minFee: probe?.fees?.min_fee_thb ?? null,
    thbOnly: probe?.currency === 'THB',
  };
  return { info, scanContext };
}

module.exports = { buildInfo, REPO };
