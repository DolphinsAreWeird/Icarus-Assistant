const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PathRun } = require('../e2e/lib/recorder.cjs');
const { statusOf, render } = require('../e2e/lib/report.cjs');
const { hasFailures } = require('../e2e/run.cjs');
const app = require('../e2e/lib/app.cjs');
const phone = require('../e2e/paths/phone.cjs');

function makeRun(t, pathId = 'screens') {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icarus-qa-gate-'));
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
  return new PathRun({ envId: 'chromium-phone', env: { label: 'Phone' }, pathId, pathTitle: pathId, outDir });
}

function report(r) {
  return render({
    opts: { base: 'http://example.test/app/' },
    info: { git: { head: 'test', branch: 'test', subject: '', dirty: [] }, dist: [], servers: {} },
    scanContext: {}, runs: [r], envIds: [r.env],
    startedAt: new Date(0), endedAt: new Date(1), pathsRun: [r.path],
  });
}

test('a high scan on a non-grid path fails the recorded run, report and exit gate', async (t) => {
  const run = makeRun(t);
  run.shot = async () => null; // Findings still count if saving the screenshot fails.
  await run.look({ evaluate: async () => ({ screen: 'Home', overlays: [], lines: ['$12.34'], empties: [] }) }, 'home');
  const json = run.toJSON();
  assert.equal(run.statusFor(), 'FAIL');
  assert.equal(json.status, 'FAIL');
  assert.equal(statusOf(json), 'FAIL');
  assert.equal(hasFailures([json]), true);
  // The gate must not trust a stale PASS from an older serialized run.
  assert.equal(hasFailures([{ ...json, status: 'PASS' }]), true);
  const md = report(json);
  assert.match(md, /P8 Placeholder.*\*\*FAIL\*\* 1 high/);
  assert.match(md, /\*\*Chromium, Pixel 7\*\*: FAIL/);
  assert.match(md, /FAIL: scan Dollar amount/);
});

test('scan findings retain their part and fail only that part plus the overall run', async (t) => {
  const run = makeRun(t, 'race');
  run.setPart('P3');
  run.shot = async () => 'screen.png';
  await run.look({ evaluate: async () => ({ screen: 'Buy', overlays: [], lines: ['undefined'], empties: [] }) }, 'review');
  assert.equal(run.findings[0].part, 'P3');
  for (const r of [run, run.toJSON()]) {
    assert.equal(statusOf(r, 'P2'), 'PASS');
    assert.equal(statusOf(r, 'P3'), 'FAIL');
    assert.equal(statusOf(r), 'FAIL');
  }
});

for (const severity of ['medium', 'low']) {
  test(`${severity} scan findings warn in the run and report without failing exit`, (t) => {
    const run = makeRun(t);
    run.findings.push({ severity, rule: 'soft', title: 'Soft finding', text: 'soft', screen: 'Home', env: run.envId, part: 'P2' });
    assert.equal(run.statusFor('P2'), 'WARN');
    assert.equal(run.statusFor('P3'), 'PASS');
    const json = run.toJSON();
    assert.equal(json.status, 'WARN');
    assert.equal(statusOf(json), 'WARN');
    assert.equal(hasFailures([json]), false);
    assert.match(report(json), /P8 Placeholder.*\*\*WARN\*\*/);
  });
}

test('clean runs pass and existing hard/fatal failures still fail the exit gate', (t) => {
  const run = makeRun(t);
  assert.equal(run.toJSON().status, 'PASS');
  assert.equal(hasFailures([run.toJSON()]), false);
  run.check('slow', false, '', 'soft');
  assert.equal(run.statusFor(), 'WARN');
  run.check('must work', false);
  assert.equal(run.statusFor(), 'FAIL');
  assert.equal(hasFailures([run.toJSON()]), true);
  const fatal = makeRun(t);
  fatal.fatal = 'browser failed';
  assert.equal(fatal.toJSON().status, 'FAIL');
  assert.equal(statusOf(fatal.toJSON()), 'FAIL');
});

for (const outcome of ['success', 'no completion', 'click error']) {
  test(`phone confirmation ${outcome} has the correct hard-failure grade`, async (t) => {
    const run = makeRun(t, 'phone');
    const originalStep = run.step.bind(run);
    // Exercise the real purchase step without the unrelated tour/question/layout steps.
    run.step = (page, name, fn, opts) => name.startsWith('Ask Icarus to buy')
      ? originalStep(page, name, fn, { ...opts, screenshot: false }) : undefined;
    run.look = async () => null;
    for (const [key, value] of Object.entries({
      openChat: async () => ({}), sleep: async () => {}, screenName: async () => 'Buy review',
      waitScreen: async (_page, screen) => { if (screen === 'Buy complete' && outcome === 'no completion') throw new Error('timeout'); },
      phone: () => ({ locator: () => ({ click: async () => { if (outcome === 'click error') throw new Error('click failed'); } }) }),
    })) {
      const original = app[key];
      app[key] = value;
      t.after(() => { app[key] = original; });
    }
    const input = { click: async () => {}, fill: async () => {}, press: async () => {} };
    await phone.run({ page: { getByPlaceholder: () => input }, run, base: 'http://example.test/' });
    const expected = outcome === 'success' ? 'PASS' : 'FAIL';
    assert.equal(run.statusFor(), expected);
    assert.equal(statusOf(run.toJSON()), expected);
    assert.equal(hasFailures([run.toJSON()]), expected === 'FAIL');
    if (expected === 'FAIL') assert.ok(run.checks.some((c) => !c.ok && c.level === 'hard'));
    assert.equal(run.data.buyByVoiceOnPhone, expected === 'PASS');
    assert.equal(run.data.cannot.some((x) => /confirm a purchase/.test(x)), expected === 'FAIL');
  });
}

test('a repeated high finding is listed once per run in Failed checks', async (t) => {
  const run = makeRun(t);
  run.shot = async () => 'screen.png';
  const page = { evaluate: async () => ({ screen: 'Home', overlays: [], lines: ['$12.34'], empties: [] }) };
  await run.look(page, 'first');
  await run.look(page, 'second');
  assert.equal(run.findings.length, 2);
  const failed = report(run.toJSON()).split('## Failed checks')[1].split('## Per-path notes')[0];
  assert.equal(failed.match(/FAIL: scan Dollar amount/g).length, 1);
});
