// summary.md: the pass/fail grid, per-path notes, grouped errors, timings, typed answers, and the scan findings.

const { ENVIRONMENTS } = require('./env.cjs');
const { statusOf } = require('./recorder.cjs');

const GRID = [
  { id: 'P1', title: 'First visit: Meet Icarus card, tour to the end, chat with starter chips', path: 'tour' },
  { id: 'P2', title: 'Race 1 by hand (stopwatch A)', path: 'race', part: 'P2' },
  { id: 'P3', title: 'Race 2 with Icarus, "No mic?" button (stopwatch B)', path: 'race', part: 'P3' },
  { id: 'P4', title: 'Eight typed questions in the chat', path: 'questions', part: 'P4' },
  { id: 'P5', title: 'U-Bot handoff card from the ride question', path: 'questions', part: 'P5' },
  { id: 'P6', title: 'Business dashboard loads with no errors', path: 'dashboard' },
  { id: 'P7', title: 'Phone: tour starts, one typed question, what is reachable', path: 'phone' },
  { id: 'P8', title: 'Placeholder and consistency scan (all screens reached)', scan: true },
];

const SEV_ORDER = { high: 0, medium: 1, low: 2 };
const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ').trim();
const sec = (ms) => (ms == null ? '-' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
const short = (s, n = 160) => {
  const t = cell(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function median(xs) {
  const a = xs.filter((x) => typeof x === 'number').sort((x, y) => x - y);
  if (!a.length) return null;
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
}

/** Unique findings: one per rule + text, with where they were seen. */
function groupFindings(runs) {
  const map = new Map();
  for (const r of runs) {
    for (const f of r.findings ?? []) {
      const key = `${f.rule}|${f.text}`;
      if (!map.has(key)) map.set(key, { ...f, envs: new Set(), screens: new Set(), shots: [] });
      const g = map.get(key);
      g.envs.add(f.env);
      g.screens.add(`${f.screen}${f.overlays ? ` (${f.overlays})` : ''}`);
      if (f.screenshot && g.shots.length < 3 && !g.shots.includes(f.screenshot)) g.shots.push(f.screenshot);
    }
  }
  return [...map.values()].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.rule.localeCompare(b.rule));
}

function normalize(text) {
  return String(text ?? '')
    .replace(/https?:\/\/[^\s)]+/g, (u) => {
      try {
        const x = new URL(u);
        return x.pathname.replace(/u_new-[a-z0-9]+/g, 'u_new-<visitor>').replace(/\/[A-Za-z0-9_-]{16,}/g, '/<id>');
      } catch {
        return u;
      }
    })
    .replace(/\d+(\.\d+)?/g, 'N')
    .slice(0, 220);
}

function groupEvents(runs, kinds) {
  const map = new Map();
  for (const r of runs) {
    for (const e of r.events ?? []) {
      if (!kinds.includes(e.kind)) continue;
      const key = `${e.kind}|${normalize(e.text)}`;
      if (!map.has(key)) map.set(key, { kind: e.kind, example: e.text, count: 0, where: new Set(), steps: new Set() });
      const g = map.get(key);
      g.count += 1;
      g.where.add(`${r.env}/${r.path}`);
      if (g.steps.size < 3) g.steps.add(e.step);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

function metricFor(gridRow, r, envId, allRuns) {
  if (gridRow.scan) {
    const envRuns = allRuns.filter((x) => x.env === envId);
    const screens = envRuns.reduce((sum, x) => sum + x.steps.filter((s) => s.screenshot).length, 0);
    const findings = groupFindings(envRuns);
    if (!screens && !findings.length) return { status: 'n/a', text: 'nothing was scanned' };
    const n = (s) => findings.filter((f) => f.severity === s).length;
    return { status: n('high') ? 'FAIL' : n('medium') || n('low') ? 'WARN' : 'PASS', text: `${n('high')} high, ${n('medium')} medium, ${n('low')} low` };
  }
  if (!r) return null;
  const status = statusOf(r, gridRow.part);
  const d = r.data ?? {};
  const t = r.timings ?? {};
  let text = '';
  switch (gridRow.id) {
    case 'P1': text = t.tour_ms != null && d.tour?.endedMs ? `tour ${sec(t.tour_ms)}` : `tour not finished (${d.tour?.progress ?? '?'})`; break;
    case 'P2': text = `A ${d.race1Stopwatch?.a ?? '-'}, ${d.race1Clicks ?? '?'} taps`; break;
    case 'P3': text = d.race2Workaround
      ? `Confirm did nothing; B ${d.race2Stopwatch?.b ?? '-'} only after ${d.race2Workaround.extraTaps} extra taps`
      : `B ${d.race2Stopwatch?.b ?? '-'}${d.race2Stopwatch?.ratio ? `, "${d.race2Stopwatch.ratio}"` : ''}`; break;
    case 'P4': {
      const a = d.answers ?? [];
      const ok = a.filter((x) => x.ms != null);
      text = `${ok.length}/8 answered, median ${sec(median(ok.map((x) => x.ms)))}`;
      break;
    }
    case 'P5': text = d.handoff ? `card${d.handoff.link ? ', link ok' : ', no link'}` : 'no card'; break;
    case 'P6': text = `ready ${sec(t.dashboard_ready_ms)}`; break;
    case 'P7': text = d.answer ? `answer ${sec(d.answer.ms)}; ${d.cannot?.length ?? 0} can't` : 'no answer'; break;
    default: text = '';
  }
  return { status, text };
}

function render({ opts, info, scanContext, runs, envIds, startedAt, endedAt, pathsRun }) {
  const L = [];
  const p = (s = '') => L.push(s);
  const byKey = (path, env) => runs.find((r) => r.path === path && r.env === env);

  p('# Icarus golden-path QA run');
  p();
  p(`- Run: ${startedAt.toISOString()} to ${endedAt.toISOString()} (${sec(endedAt - startedAt)})`);
  p(`- App: ${opts.base}`);
  p(`- Build: git ${info.git.head} on ${info.git.branch} ("${cell(info.git.subject)}")${info.git.dirty.length ? `, with uncommitted changes in: ${info.git.dirty.map((l) => l.slice(3)).join(', ')}` : ''}`);
  const dist = info.dist.find((d) => d.file.endsWith('app.js'));
  if (dist) p(`- Built app: frontend/dist/app.js ${dist.missing ? 'missing' : `built ${dist.modified}, sha1 ${dist.sha1}`}. The app was being edited during the run: findings belong to this build.`);
  const b = info.servers.backend ?? {};
  p(`- Backend: ${b.error ? `not reachable (${b.error})` : `engine ${b.engine}, assistant ${cell(b.assistant)}, prices ${JSON.stringify(b.prices ?? {})}`}`);
  p(`- Voice server: ${info.servers.voice?.error ? info.servers.voice.error : `ElevenLabs key ${info.servers.voice?.apiKeySet ? 'set' : 'missing'}, fake=${info.servers.voice?.fakeElevenLabs}, publicDemo=${Boolean(info.servers.voice?.publicDemo)}`}`);
  p(`- Demo account: ${info.demoAccount && !info.demoAccount.error ? `"${info.demoAccount.display_name}", ${info.demoAccount.cash_thb} ${info.demoAccount.currency}, fee ${info.demoAccount.fees?.trading_fee_pct}% (min ฿${info.demoAccount.fees?.min_fee_thb})` : 'not read'}`);
  p(`- Scan context: prices live = ${scanContext.pricesLive}, demo user = ${scanContext.displayName ?? '?'}, fee = ${scanContext.feePct ?? '?'}%`);
  p(`- Re-run: \`node qa/e2e/run.cjs --base ${opts.base} --out <dir>\``);
  p();

  // ---- grid ----
  p('## Pass/fail grid');
  p();
  p(`| Path | ${envIds.map((e) => ENVIRONMENTS[e].label).join(' | ')} |`);
  p(`|---|${envIds.map(() => '---').join('|')}|`);
  for (const g of GRID) {
    const cells = envIds.map((env) => {
      if (g.scan) {
        if (!runs.some((r) => r.env === env)) return 'not run';
        const m = metricFor(g, null, env, runs);
        return `**${m.status}** ${m.text}`;
      }
      if (!pathsRun.includes(g.path)) return 'not run';
      const r = byKey(g.path, env);
      if (!r) return 'n/a';
      const m = metricFor(g, r, env, runs);
      return `**${m.status}** ${cell(m.text)}`;
    });
    p(`| ${g.id} ${g.title} | ${cells.join(' | ')} |`);
  }
  p();
  p('PASS: every check passed. WARN: the path worked, with soft problems (slow, wording, layout) or page errors. FAIL: the path broke or a must-have check failed. n/a: not run in that environment by design (races need the laptop console; questions cost model calls). P8 is FAIL when a high-severity placeholder is on screen.');
  p();

  // ---- failures and warnings ----
  p('## Failed checks');
  p();
  let anyFailed = false;
  for (const r of runs) {
    const bad = r.checks.filter((c) => !c.ok && c.level !== 'info');
    const badSteps = r.steps.filter((s) => s.status === 'failed');
    // One line per distinct high finding in this run (a stuck placeholder is seen on every later screenshot).
    const highByKey = new Map();
    for (const f of r.findings ?? []) {
      const key = `${f.part ?? ''}|${f.rule}|${f.text}`;
      if (f.severity === 'high' && !highByKey.has(key)) highByKey.set(key, f);
    }
    const highFindings = [...highByKey.values()];
    if (!bad.length && !badSteps.length && !highFindings.length && !r.fatal) continue;
    anyFailed = true;
    p(`- **${r.env} / ${r.path}**`);
    if (r.fatal) p(`  - run error: ${cell(r.fatal)}`);
    for (const s of badSteps) p(`  - step failed: "${cell(s.name)}": ${short(s.error, 300)}${s.screenshot ? ` (${s.screenshot})` : ''}`);
    for (const c of bad) p(`  - ${c.level === 'hard' ? 'FAIL' : 'warn'}${c.part ? ` [${c.part}]` : ''}: ${cell(c.name)}${c.detail ? `: ${short(c.detail, 260)}` : ''}`);
    for (const f of highFindings) p(`  - FAIL${f.part ? ` [${f.part}]` : ''}: scan ${cell(f.title)}: ${short(f.text, 260)}${f.screenshot ? ` (${f.screenshot})` : ''}`);
  }
  if (!anyFailed) p('None.');
  p();

  // ---- per-path notes ----
  p('## Per-path notes');
  for (const pathId of ['tour', 'race', 'questions', 'dashboard', 'phone', 'screens']) {
    const title = { tour: 'P1 First visit and tour', race: 'P2 + P3 The race', questions: 'P4 + P5 Typed questions and U-Bot', dashboard: 'P6 Business dashboard', phone: 'P7 Phone', screens: 'P8 Screen sweep (the scan also runs on every screenshot above)' }[pathId];
    const rs = runs.filter((r) => r.path === pathId);
    if (!rs.length) continue;
    p();
    p(`### ${title}`);
    for (const r of rs) {
      p();
      p(`**${ENVIRONMENTS[r.env].label}**: ${statusOf(r, undefined)} in ${sec(r.durationMs)}${r.video ? `, video \`${r.video}\`` : ''}`);
      p();
      for (const s of r.steps) {
        const mark = s.status === 'ok' ? 'ok' : s.status === 'failed' ? 'FAILED' : 'skipped';
        p(`- ${mark}: ${cell(s.name)} (${sec(s.ms)})${s.error ? `: ${short(s.error, 220)}` : ''}${s.screenshot ? ` \`${s.screenshot}\`` : ''}`);
      }
      const d = r.data ?? {};
      if (pathId === 'tour' && d.tour) {
        p(`- Tour: ${d.tour.endedMs ? `ended after ${sec(d.tour.endedMs)}` : 'did not end'}, progress ${d.tour.progress}. Voice: ${d.tourTts ? `${d.tourTts.complete}/${d.tourTts.lines} lines arrived in full (${d.tourTts.seconds} s of audio)${d.tourTts.problems.length ? `; problems: ${d.tourTts.problems.join('; ')}` : ''}; the browser reported ${d.tourTts.reportedAborted} of these requests as aborted` : '-'}`);
        if (d.tour.questions?.length) p(`- Tour questions shown: ${d.tour.questions.map((q) => `"${cell(q)}"`).join(', ')}`);
        if (d.tour.captions?.length) p(`- Tour captions seen: ${d.tour.captions.slice(0, 9).map((c) => `"${short(c, 90)}"`).join(' / ')}`);
        if (d.afterTour) p(`- After the tour: "${short(d.afterTour.welcome, 120)}"; chips: ${d.afterTour.chips.join(', ') || 'none'}`);
      }
      if (pathId === 'race') {
        if (d.goldRow) p(`- Invest list row: ${d.goldRow.join(' / ')}; detail page: ${(d.goldDetailTop ?? []).join(' / ')}`);
        if (d.race1Review) p(`- Race 1 review: amount ${d.race1Review['Purchase amount']}, fee ${d.race1Review['Transaction fee']}, total ${d.race1Review.Total}, pay from ${d.race1Review['Pay from']}`);
        if (d.race1Stopwatch) p(`- Race 1: ${d.race1Clicks} taps after Start; stopwatch A = ${d.race1Stopwatch.a} (measured by the test ${sec(r.timings.race1_measured_ms)})`);
        if (d.race2Voice) p(`- Race 2 voice window: ${d.race2Voice.slice(-3).map((x) => `"${short(x, 140)}"`).join(' > ')}`);
        if (d.race2Workaround) p(`- Race 2: Confirm purchase did nothing after Icarus filled the screen; ${d.race2Workaround.worked ? `close the voice window > back > Review purchase > Confirm purchase (${d.race2Workaround.extraTaps} more taps) completed it` : `close > back > Review > Confirm did not work either: ${cell(d.race2Workaround.error)}`}`);
        if (d.race2Stopwatch) p(`- Race 2: stopwatch B = ${d.race2Stopwatch.b}; Say to Review ${sec(r.timings.race2_say_to_review_ms)}; comparison "${d.race2Stopwatch.ratio || 'none'}" ${d.race2Stopwatch.ratioInViewport ? '(on screen)' : `(not on screen without scrolling: y=${d.race2Stopwatch.ratioTop}, viewport ${d.race2Stopwatch.viewportHeight})`}`);
        if (d.dashboardLive) p(`- Dashboard after the races: Scenario A time ${d.dashboardLive.a}, Scenario B time ${d.dashboardLive.b}, purchases ${d.dashboardLive.purchases}`);
      }
      if (pathId === 'questions' && d.openChat) p(`- Chat opened with: ${d.openChat.via}`);
      if (pathId === 'questions' && d.handoff) p(`- U-Bot card: "${cell(d.handoff.title)}"; link "${d.handoff.link?.text}" -> ${d.handoff.link?.href} (target ${d.handoff.link?.target}); prompt: "${short(d.handoff.prompt, 300)}"`);
      if (pathId === 'phone') {
        if (d.layout) p(`- Layout: screen ${d.layout.viewport.w}x${d.layout.viewport.h}, page ${d.layout.page.w}x${d.layout.page.h}, phone mock ${d.layout.phoneFrame?.w}x${d.layout.phoneFrame?.h}, Icarus button at y=${d.layout.mascotButton?.y}, side console at y=${d.layout.sideConsole?.y}, stopwatch at y=${d.layout.stopwatch?.y}`);
        if (d.answer) p(`- Typed question: ${sec(d.answer.ms)}, "${short(d.answer.text, 160)}"`);
        if (d.can) p(`- A phone visitor can: ${d.can.join('; ') || '-'}`);
        if (d.cannot) p(`- A phone visitor cannot: ${d.cannot.join('; ') || '-'}`);
      }
      if (pathId === 'screens') {
        if (d.homeHeader) p(`- Home header: ${d.homeHeader.join(' / ')}`);
        if (d.welcome) p(`- Chat welcome: "${short(d.welcome, 160)}" (opened with: ${d.chatOpenedWith})`);
        const filters = ['Crypto', 'Stocks', 'Gold'].filter((f) => d[`filter_${f}`] !== undefined).map((f) => `${f} ${d[`filter_${f}`]}`);
        if (filters.length) p(`- Invest filters, assets listed: ${filters.join(', ')}`);
        if (d.buyAmount) p(`- Buy amount with 1000 typed: quantity ${d.buyAmount['Estimated quantity']}, price ${d.buyAmount.Price}, fee ${d.buyAmount['Transaction fee']}`);
        if (d.explainAnswer !== undefined) p(`- "Explain anything", tap chart, Ask Icarus: ${d.explainAnswer ? `${sec(d.explainAnswer.ms)}, "${short(d.explainAnswer.text, 200)}"` : 'no answer'}`);
        if (d.guide !== undefined) p(`- "Step-by-step guide": ${d.guide ? `${d.guide.shown} after ${sec(d.guide.ms)}` : 'nothing appeared'}`);
        if (d.justTalk) p(`- "Just talk": voice window ${d.justTalk.visible ? 'opened' : 'did not open'}: "${short(d.justTalk.text, 160)}"`);
      }
      for (const n of r.notes ?? []) if (!/^tap \d+:/.test(n.text)) p(`- note: ${short(n.text, 300)}`);
      const taps = (r.notes ?? []).filter((n) => /^tap \d+:/.test(n.text)).map((n) => n.text.replace(/^tap \d+: /, ''));
      if (taps.length) p(`- Race 1 taps: ${taps.join(' > ')}`);
      const fallback = (r.appInfo ?? []).filter((i) => /did not answer|scripted/i.test(i.text));
      if (fallback.length) p(`- App console says the backend did not answer ${fallback.length} time(s): ${short(fallback[0].text, 200)}`);
    }
  }
  p();

  // ---- typed questions ----
  const qRuns = runs.filter((r) => r.path === 'questions');
  if (qRuns.length) {
    p('## Typed questions (P4)');
    for (const r of qRuns) {
      p();
      p(`**${ENVIRONMENTS[r.env].label}**`);
      p();
      p('| # | Question | Time to answer | Answer (as shown) | Card / screen after | Backend | Errors | Screenshot |');
      p('|---|---|---|---|---|---|---|---|');
      for (const [i, a] of (r.data.answers ?? []).entries()) {
        const card = a.cards?.handoff ? 'U-Bot card' : a.cards?.info ? `${a.cards.info.kind} card "${short(a.cards.info.label, 50)}"` : a.cards?.trade ? 'trade card' : 'none';
        const be = a.backend?.length ? a.backend.map((x) => `${x.status} in ${sec(x.ms)}${x.cards?.length ? `, card ${x.cards.join('+')}` : ''}`).join('; ') : a.route?.some((x) => x.kind === 'handoff') ? 'routed to U-Bot (no /chat)' : 'no /chat call';
        p(`| ${i + 1} | ${cell(a.q)} | ${a.ms == null ? 'NO ANSWER' : sec(a.ms)} | ${short(a.text, 220)}${a.sources ? ` _(based on: ${short(a.sources, 80)})_` : ''} | ${card}; ${a.screen}${a.chatOpenAfter ? '' : ', chat closed'} | ${cell(be)} | ${a.errors.length ? short(a.errors.join(' / '), 120) : '-'} | \`${a.screenshot ?? ''}\` |`);
      }
    }
    p();
  }

  // ---- timings ----
  p('## Timings');
  p();
  const metrics = [
    ['App ready (window.Icarus)', (r) => r.timings.app_ready_ms, ['tour', 'race', 'questions', 'screens', 'phone']],
    ['Demo account loaded', (r) => r.timings.demo_account_ms, ['race', 'questions', 'screens']],
    ['Tour, click to "Tour" pill back', (r) => r.timings.tour_ms, ['tour']],
    ['Race 1, Start to Purchase complete (test clock)', (r) => r.timings.race1_measured_ms, ['race']],
    ['Race 1, stopwatch A', (r) => r.data.race1Stopwatch?.a, ['race'], true],
    ['Race 2, Say to Review screen', (r) => r.timings.race2_say_to_review_ms, ['race']],
    ['Race 2, Start to Purchase complete (test clock)', (r) => r.timings.race2_measured_ms, ['race']],
    ['Race 2, stopwatch B', (r) => r.data.race2Stopwatch?.b, ['race'], true],
    ['Typed answer, median', (r) => median((r.data.answers ?? []).map((a) => a.ms)), ['questions']],
    ['Typed answer, slowest', (r) => Math.max(...(r.data.answers ?? []).map((a) => a.ms ?? 0)), ['questions']],
    ['Backend /chat, median', (r) => median(r.requests.filter((q) => /\/brain\/chat$/.test(q.url)).map((q) => q.ms)), ['questions']],
    ['Phone typed answer', (r) => r.timings.question_ms, ['phone']],
    ['Dashboard ready', (r) => r.timings.dashboard_ready_ms, ['dashboard']],
  ];
  p(`| Metric | ${envIds.map((e) => ENVIRONMENTS[e].label).join(' | ')} |`);
  p(`|---|${envIds.map(() => '---').join('|')}|`);
  for (const [name, get, paths, raw] of metrics) {
    const vals = envIds.map((env) => {
      const rs = runs.filter((r) => r.env === env && paths.includes(r.path));
      const xs = rs.map((r) => {
        try {
          return get(r);
        } catch {
          return null;
        }
      }).filter((x) => x != null && x !== '' && !(typeof x === 'number' && !Number.isFinite(x)));
      if (!xs.length) return '-';
      if (raw) return xs.join(', ');
      return paths.length > 1 && xs.length > 1 ? `${sec(median(xs))} (median of ${xs.length})` : sec(xs[0]);
    });
    if (vals.every((v) => v === '-')) continue;
    p(`| ${name} | ${vals.join(' | ')} |`);
  }
  p();

  // ---- errors ----
  p('## Console and page errors (grouped)');
  p();
  const errs = groupEvents(runs, ['pageerror', 'crash', 'console.error', 'console.warning', 'dialog']);
  if (!errs.length) p('None.');
  else {
    p('| Count | Kind | Message (example) | Where (env/path) | Step |');
    p('|---|---|---|---|---|');
    for (const e of errs) p(`| ${e.count} | ${e.kind} | ${short(e.example, 220)} | ${[...e.where].join(', ')} | ${short([...e.steps].join('; '), 120)} |`);
  }
  p();
  p('## Failed requests (grouped)');
  p();
  const reqs = groupEvents(runs, ['request.failed', 'http']);
  if (!reqs.length) p('None (status >= 400 or network failure).');
  else {
    p('| Count | Kind | Request (example) | Where (env/path) | Step |');
    p('|---|---|---|---|---|');
    for (const e of reqs) p(`| ${e.count} | ${e.kind} | ${short(e.example, 200)} | ${[...e.where].join(', ')} | ${short([...e.steps].join('; '), 120)} |`);
  }
  const aborted = groupEvents(runs, ['request.aborted']);
  if (aborted.length) {
    p();
    p(`Aborted by the browser (usually harmless: speech cut off when the next line starts, an image replaced): ${aborted.map((e) => `${e.count}x ${normalize(e.example).split(' ').slice(0, 2).join(' ')}`).join(', ')}.`);
  }
  p();

  // ---- findings ----
  p('## Placeholder and consistency findings');
  p();
  const findings = groupFindings(runs);
  if (!findings.length) p('None.');
  else {
    p('| Severity | Finding | Text on screen | Where (screen) | Envs | Screenshots |');
    p('|---|---|---|---|---|---|');
    for (const f of findings) p(`| ${f.severity} | ${cell(f.title)} | ${short(f.text, 140)} | ${short([...f.screens].slice(0, 4).join('; '), 140)} | ${[...f.envs].join(', ')} | ${f.shots.map((s) => `\`${s}\``).join(' ')} |`);
  }
  p();
  p('## Files');
  p();
  p('- `results.json`: everything above, plus every check, request timing and console line.');
  p('- `logs/<env>__<path>.json`: one run each.');
  p('- `screenshots/<env>/<path>/NN-step.png`: a screenshot after every step (and every 8 s of the tour).');
  p('- `videos/<env>__<path>.webm`: a video of every run.');
  p();
  return L.join('\n');
}

module.exports = { render, statusOf, GRID, groupFindings };
