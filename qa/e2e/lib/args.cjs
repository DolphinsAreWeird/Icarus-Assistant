// Command-line options for qa/e2e/run.cjs.

const os = require('node:os');
const path = require('node:path');

const HELP = `
Icarus golden-path QA suite

  node qa/e2e/run.cjs --base http://localhost:8789/app/ --out <dir>

Options
  --base <url>        The app (default http://localhost:8789/app/). Use a voice server WITHOUT PUBLIC_DEMO,
                      or the per-visitor rate limits will fail the typed questions.
  --out <dir>         Where results go (default: <tmp>/icarus-qa-runs/<timestamp>). Videos are large: keep them out of git.
  --envs <list>       Comma list of environments (default: all):
                      chromium-laptop, chromium-phone, webkit-laptop, webkit-phone
  --paths <list>      Comma list of paths (default: all): tour, race, questions, dashboard, phone, screens
  --questions-envs <list>  Where the typed questions run (default: chromium-laptop,webkit-phone). Each one may cost
                      a model call on the backend.
  --workers <n>       Run this many (env, path) jobs at once (default 1: timings are cleaner one at a time).
  --headed            Show the browsers.
  --no-video          Do not record videos.
  --playwright <dir>  Where the playwright package is (default: require('playwright'), then the npx cache).
  --help              This text.
`;

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function parseArgs(argv) {
  const opts = {
    base: 'http://localhost:8789/app/',
    out: null,
    envs: null,
    paths: null,
    questionsEnvs: ['chromium-laptop', 'webkit-phone'],
    workers: 1,
    headed: false,
    video: true,
    playwright: null,
    startedAt: new Date(),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    const list = () => value().split(',').map((s) => s.trim()).filter(Boolean);
    switch (a) {
      case '--base': opts.base = value(); break;
      case '--out': opts.out = value(); break;
      case '--envs': opts.envs = list(); break;
      case '--paths': opts.paths = list(); break;
      case '--questions-envs': opts.questionsEnvs = list(); break;
      case '--workers': opts.workers = Math.max(1, Number(value()) || 1); break;
      case '--headed': opts.headed = true; break;
      case '--no-video': opts.video = false; break;
      case '--playwright': opts.playwright = value(); break;
      case '--help': case '-h': opts.help = true; break;
      default: throw new Error(`Unknown option ${a}. Try --help.`);
    }
  }
  if (!/\/$/.test(opts.base)) opts.base += '/';
  opts.out = path.resolve(opts.out ?? path.join(os.tmpdir(), 'icarus-qa-runs', stamp(opts.startedAt)));
  return opts;
}

module.exports = { parseArgs, HELP, stamp };
