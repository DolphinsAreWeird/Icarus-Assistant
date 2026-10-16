#!/usr/bin/env node
// Icarus golden-path QA suite. One command runs every path in every environment and writes a report.
//
//   node qa/e2e/run.cjs --base http://localhost:8789/app/ --out <dir>
//
// See qa/README.md. Nothing here changes the app: it only drives a browser and reads what is on screen.

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs, HELP } = require('./lib/args.cjs');
const { ENVIRONMENTS, loadPlaywright, contextOptions } = require('./lib/env.cjs');
const { PathRun } = require('./lib/recorder.cjs');
const { buildInfo } = require('./lib/build-info.cjs');
const { render, statusOf, GRID } = require('./lib/report.cjs');

const PATHS = ['tour', 'race', 'questions', 'dashboard', 'phone', 'screens'].map((id) => require(`./paths/${id}.cjs`));
const JOB_LIMIT_MS = 8 * 60_000; // one (env, path) run; the tour is the longest at about a minute

async function runJob(pw, job, opts, scanContext, log) {
  const { envId, env, mod } = job;
  const run = new PathRun({ envId, env, pathId: mod.id, pathTitle: mod.title, outDir: opts.out, scanContext });
  const videoTmp = opts.video ? path.join(opts.out, 'videos', '.tmp', `${envId}__${mod.id}`) : null;
  let browser = null;
  let context = null;
  let page = null;
  try {
    browser = await pw[env.browser].launch({ headless: !opts.headed });
    context = await browser.newContext(contextOptions(pw, env, videoTmp));
    // Nothing should open a new tab (the U-Bot link is never clicked). If something does, note it and close it.
    context.on('page', (p) => {
      if (page && p !== page) {
        run.events.push({ kind: 'console.warning', text: `A new tab opened: ${p.url()}`, at: run.elapsed(), step: run.currentStep, part: run.part });
        void p.close().catch(() => undefined);
      }
    });
    page = await context.newPage();
    run.attach(page);
    let timer;
    const limit = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${JOB_LIMIT_MS / 60000} min`)), JOB_LIMIT_MS);
    });
    try {
      await Promise.race([mod.run({ page, run, base: opts.base, env, envId, opts }), limit]);
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    run.fatal = String(e?.message ?? e).split('\n')[0];
    run.note(`run error: ${run.fatal}`);
  } finally {
    run.endedAt = Date.now();
    const video = page?.video?.() ?? null;
    await context?.close().catch(() => undefined);
    if (video) {
      const dest = path.join(opts.out, 'videos', `${envId}__${mod.id}.webm`);
      try {
        await video.saveAs(dest);
        await video.delete().catch(() => undefined);
        run.video = path.relative(opts.out, dest);
      } catch (e) {
        run.note(`video not saved: ${String(e.message).split('\n')[0]}`);
      }
    }
    await browser?.close().catch(() => undefined);
  }
  const json = { ...run.toJSON(), fatal: run.fatal ?? null };
  if (json.fatal) json.status = 'FAIL';
  fs.writeFileSync(path.join(opts.out, 'logs', `${envId}__${mod.id}.json`), JSON.stringify(json, null, 2));
  const parts = Array.isArray(mod.grid) ? mod.grid.map((g) => `${g} ${statusOf(json, g)}`).join(', ') : `${mod.grid} ${statusOf(json, undefined)}`;
  log(`${parts.padEnd(22)} ${mod.id.padEnd(10)} ${envId.padEnd(16)} ${(json.durationMs / 1000).toFixed(1)} s${json.fatal ? `  (${json.fatal})` : ''}`);
  return json;
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    console.log(HELP);
    return;
  }
  const pw = loadPlaywright(opts.playwright);
  for (const d of ['videos', 'screenshots', 'logs']) fs.mkdirSync(path.join(opts.out, d), { recursive: true });

  const envIds = (opts.envs ?? Object.keys(ENVIRONMENTS)).filter((e) => {
    if (!ENVIRONMENTS[e]) throw new Error(`Unknown environment ${e}. Known: ${Object.keys(ENVIRONMENTS).join(', ')}`);
    return true;
  });
  const wanted = opts.paths ?? PATHS.map((m) => m.id);
  for (const id of wanted) if (!PATHS.some((m) => m.id === id)) throw new Error(`Unknown path ${id}. Known: ${PATHS.map((m) => m.id).join(', ')}`);

  console.log(`Icarus QA: ${opts.base}`);
  console.log(`Results:   ${opts.out}`);
  const { info, scanContext } = await buildInfo(opts.base);
  if (info.servers.voice?.error) throw new Error(`The app's server does not answer at ${opts.base} (${info.servers.voice.error}). Start it first.`);
  if (info.servers.voice?.publicDemo) console.log('Warning: this server has PUBLIC_DEMO on, so per-visitor rate limits apply. Typed questions may get 429s.');
  console.log(`Build:     git ${info.git.head}${info.git.dirty.length ? ` + ${info.git.dirty.length} changed files` : ''}; backend prices ${JSON.stringify(info.servers.backend?.prices ?? {})}; demo user ${scanContext.displayName ?? '?'}`);
  fs.writeFileSync(path.join(opts.out, 'build.json'), JSON.stringify({ info, scanContext }, null, 2));

  const jobs = [];
  for (const mod of PATHS.filter((m) => wanted.includes(m.id))) {
    const envs = mod.envs === 'questions' ? opts.questionsEnvs : mod.envs;
    for (const envId of envIds.filter((e) => envs.includes(e))) jobs.push({ envId, env: ENVIRONMENTS[envId], mod });
  }
  console.log(`Jobs:      ${jobs.length} (${opts.workers} at a time)\n`);

  const results = [];
  let next = 0;
  let done = 0;
  const log = (line) => console.log(`[${String(++done).padStart(2)}/${jobs.length}] ${line}`);
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      results.push(await runJob(pw, job, opts, scanContext, log));
    }
  };
  const startedAt = opts.startedAt;
  await Promise.all(Array.from({ length: Math.min(opts.workers, jobs.length) }, worker));
  const endedAt = new Date();
  fs.rmSync(path.join(opts.out, 'videos', '.tmp'), { recursive: true, force: true });

  // Same order as the job list, whatever finished first.
  results.sort((a, b) => jobs.findIndex((j) => j.envId === a.env && j.mod.id === a.path) - jobs.findIndex((j) => j.envId === b.env && j.mod.id === b.path));
  const pathsRun = [...new Set(jobs.map((j) => j.mod.id))];
  fs.writeFileSync(path.join(opts.out, 'results.json'), JSON.stringify({ opts: { ...opts, startedAt: startedAt.toISOString() }, info, scanContext, grid: GRID, runs: results }, null, 2));
  const md = render({ opts, info, scanContext, runs: results, envIds, startedAt, endedAt, pathsRun });
  fs.writeFileSync(path.join(opts.out, 'summary.md'), md);

  // The grid, on the terminal too.
  const gridStart = md.indexOf('## Pass/fail grid');
  console.log(`\n${md.slice(gridStart, md.indexOf('\nPASS: every check', gridStart))}`);
  console.log(`Summary: ${path.join(opts.out, 'summary.md')}`);
  const failed = results.some((r) => r.status === 'FAIL');
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(`QA run failed: ${e.message}`);
  process.exitCode = 2;
});
