// One recorded run of one path in one environment: steps, checks, screenshots, console and network events, timings.
// A path can have parts that are graded separately (the race path is Race 1 and Race 2 in one page, because the
// stopwatch only compares the two when both run in the same page).

const fs = require('node:fs');
const path = require('node:path');
const { scanPage } = require('./scan.cjs');

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** Aborted requests are what a browser does when speech is interrupted or an image is replaced: not failures. */
const ABORTED = /ERR_ABORTED|cancelled|NS_BINDING_ABORTED|Load request cancelled/i;

class PathRun {
  constructor({ envId, env, pathId, pathTitle, outDir, scanContext, part = null }) {
    this.envId = envId;
    this.env = env;
    this.pathId = pathId;
    this.pathTitle = pathTitle;
    this.outDir = outDir;
    this.scanContext = scanContext ?? {};
    this.shotDir = path.join(outDir, 'screenshots', envId, pathId);
    fs.mkdirSync(this.shotDir, { recursive: true });
    this.startedAt = Date.now();
    this.endedAt = null;
    this.steps = [];
    this.checks = [];
    this.notes = [];
    this.events = []; // console errors and warnings, page errors, failed requests
    this.appInfo = []; // the app's own "[icarus] ..." console lines
    this.requests = []; // timed /api and /brain calls
    this.timings = {};
    this.findings = []; // placeholder and consistency scan results
    this.data = {}; // anything a path wants in the report (answers, stopwatch readings...)
    this.shotCount = 0;
    this.currentStep = '(setup)';
    this.part = part;
    this.abortedParts = {}; // part -> step name that failed
    this.video = null;
  }

  get aborted() {
    return this.abortedParts[this.part ?? '_'] ?? null;
  }

  /** Start grading a new part. Steps after a failed step in an earlier part still run. */
  setPart(part) {
    this.part = part;
  }

  elapsed() {
    return Date.now() - this.startedAt;
  }

  /** Listen to everything a page reports. */
  attach(page) {
    const where = () => ({ at: this.elapsed(), step: this.currentStep, part: this.part });
    page.on('console', (m) => {
      const type = m.type();
      const text = m.text();
      if (type === 'error' || type === 'warning') this.events.push({ kind: `console.${type}`, text, url: m.location()?.url ?? '', ...where() });
      else if (/^\[icarus\]/.test(text)) this.appInfo.push({ text, ...where() });
    });
    page.on('pageerror', (e) => this.events.push({ kind: 'pageerror', text: `${e.name}: ${e.message}`, stack: String(e.stack ?? '').split('\n').slice(0, 4).join(' | '), ...where() }));
    page.on('crash', () => this.events.push({ kind: 'crash', text: 'The page crashed', ...where() }));
    page.on('dialog', (d) => {
      this.events.push({ kind: 'dialog', text: `${d.type()}: ${d.message()}`, ...where() });
      void d.dismiss().catch(() => undefined);
    });
    const starts = new Map();
    page.on('request', (r) => {
      if (/\/(api|brain)\//.test(r.url())) starts.set(r, Date.now());
    });
    page.on('requestfailed', (r) => {
      const err = r.failure()?.errorText ?? 'failed';
      this.events.push({ kind: ABORTED.test(err) ? 'request.aborted' : 'request.failed', text: `${r.method()} ${r.url()} ${err}`, url: r.url(), ...where() });
      const t = starts.get(r);
      if (t) this.requests.push({ method: r.method(), url: r.url(), status: 0, ms: Date.now() - t, error: err, at: t - this.startedAt, step: this.currentStep });
    });
    page.on('response', (res) => {
      if (res.status() >= 400) this.events.push({ kind: 'http', text: `${res.request().method()} ${res.url()} -> ${res.status()}`, url: res.url(), status: res.status(), ...where() });
    });
    page.on('requestfinished', async (r) => {
      const t = starts.get(r);
      if (!t) return;
      const res = await r.response().catch(() => null);
      const entry = { method: r.method(), url: r.url(), status: res?.status() ?? 0, ms: Date.now() - t, at: t - this.startedAt, step: this.currentStep };
      if (/\/brain\/chat$/.test(r.url()) && res) {
        try {
          const body = await res.json();
          entry.reply = {
            text: body?.text,
            sources: (body?.sources ?? []).map((s) => `${s?.tool ?? ''} · ${s?.provider ?? ''}${s?.freshness ? ` (${s.freshness})` : ''}`),
            cards: (body?.ui_actions ?? []).filter((a) => a?.type === 'card').map((a) => a.card_type),
            actions: (body?.ui_actions ?? []).map((a) => a?.type),
          };
          try {
            entry.request = JSON.parse(r.postData() ?? '{}').text;
          } catch {
            // no body
          }
        } catch {
          // not JSON
        }
      }
      if (/\/api\/utopia\/route$/.test(r.url()) && res) {
        try {
          const body = await res.json();
          entry.route = body?.kind;
        } catch {
          // not JSON
        }
      }
      if (/\/api\/tts$/.test(r.url()) && res) entry.ttsCache = res.headers()['x-tts-cache'];
      this.requests.push(entry);
    });
  }

  note(text) {
    this.notes.push({ text, step: this.currentStep, part: this.part, at: this.elapsed() });
  }

  timing(key, ms) {
    this.timings[key] = Math.round(ms);
  }

  /**
   * A check. level: 'hard' fails the path, 'soft' makes it a warning, 'info' is only recorded.
   * Returns ok so a path can branch on it.
   */
  check(name, ok, detail = '', level = 'hard') {
    this.checks.push({ name, ok: Boolean(ok), detail: String(detail ?? ''), level, step: this.currentStep, part: this.part, at: this.elapsed() });
    return Boolean(ok);
  }

  /** A screenshot of what the visitor sees now. Returns the file name relative to the results folder. */
  async shot(page, name, opts = {}) {
    this.shotCount += 1;
    const file = path.join(this.shotDir, `${String(this.shotCount).padStart(2, '0')}-${slug(name)}${opts.fullPage ? '-full' : ''}.png`);
    try {
      await page.screenshot({ path: file, fullPage: Boolean(opts.fullPage), timeout: 15_000 });
    } catch (e) {
      this.note(`screenshot failed: ${String(e.message).split('\n')[0]}`);
      return null;
    }
    return path.relative(this.outDir, file);
  }

  /** Screenshot plus the placeholder and consistency scan of what is on screen. */
  async look(page, name, opts = {}) {
    const file = await this.shot(page, name, opts);
    try {
      const found = await scanPage(page, this.scanContext);
      for (const f of found) this.findings.push({ ...f, screenshot: file, step: this.currentStep, env: this.envId, path: this.pathId });
    } catch (e) {
      this.note(`scan failed: ${String(e.message).split('\n')[0]}`);
    }
    return file;
  }

  /**
   * A step. A step that throws is recorded as failed; if it is critical (the default) the rest of this part is
   * skipped, because later steps depend on it.
   */
  async step(page, name, fn, opts = {}) {
    const { critical = true, screenshot = true } = opts;
    if (this.aborted) {
      this.steps.push({ name, status: 'skipped', critical, part: this.part, ms: 0, error: `skipped: "${this.aborted}" failed` });
      return undefined;
    }
    this.currentStep = name;
    const t0 = Date.now();
    const rec = { name, status: 'ok', critical, part: this.part, ms: 0, error: null, screenshot: null, at: t0 - this.startedAt };
    this.steps.push(rec);
    let value;
    try {
      value = await fn();
    } catch (e) {
      rec.status = 'failed';
      rec.error = String(e?.message ?? e).split('\n').filter(Boolean).slice(0, 3).join(' ');
      if (critical) this.abortedParts[this.part ?? '_'] = name;
    }
    rec.ms = Date.now() - t0;
    if (screenshot && page && !page.isClosed()) rec.screenshot = await this.look(page, `${name}${rec.status === 'failed' ? ' FAILED' : ''}`);
    return value;
  }

  /** PASS, WARN or FAIL, for the whole run or one part. */
  statusFor(part) {
    const inPart = (x) => part === undefined || (x.part ?? null) === part;
    const aborted = part === undefined ? Object.keys(this.abortedParts).length > 0 : Boolean(this.abortedParts[part ?? '_']);
    if (aborted) return 'FAIL';
    if (this.checks.some((c) => inPart(c) && !c.ok && c.level === 'hard')) return 'FAIL';
    if (this.steps.some((s) => inPart(s) && s.status === 'failed')) return 'WARN';
    if (this.checks.some((c) => inPart(c) && !c.ok && c.level === 'soft')) return 'WARN';
    if (this.events.some((e) => inPart(e) && (e.kind === 'pageerror' || e.kind === 'crash'))) return 'WARN';
    return 'PASS';
  }

  toJSON() {
    return {
      env: this.envId,
      envLabel: this.env.label,
      path: this.pathId,
      title: this.pathTitle,
      status: this.statusFor(undefined),
      durationMs: (this.endedAt ?? Date.now()) - this.startedAt,
      abortedParts: this.abortedParts,
      steps: this.steps,
      checks: this.checks,
      notes: this.notes,
      timings: this.timings,
      data: this.data,
      events: this.events,
      appInfo: this.appInfo,
      requests: this.requests,
      findings: this.findings,
      video: this.video,
    };
  }
}

module.exports = { PathRun, slug, ABORTED };
