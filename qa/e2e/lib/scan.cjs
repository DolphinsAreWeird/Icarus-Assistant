// The placeholder and consistency scan, run on every screen the suite reaches.
//
// It reads the rendered text of the page (the phone, the side console and any card over them), plus a few
// structural facts (which screen is showing, which lists are empty), and applies the rules below. Every rule is
// about what a judge would read, so it works on text, not on the design file.

/** Collected in the page. Plain function: Playwright sends its source to the browser. */
function collect() {
  const phone = document.querySelector('[data-screen-label="Phone"]');
  const inner = phone?.querySelector('[data-screen-label]');
  const screen = inner?.getAttribute('data-screen-label') ?? document.querySelector('[data-screen-label]')?.getAttribute('data-screen-label') ?? '(none)';
  const overlays = [];
  if (document.querySelector('[role="dialog"][aria-label="Meet Icarus"]')) overlays.push('intro');
  if (document.body.classList.contains('ic-touring')) overlays.push('tour');
  if ([...document.querySelectorAll('input')].some((i) => (i.placeholder ?? '').startsWith('Ask Icarus'))) overlays.push('chat');
  if (document.querySelector('[data-ui-id="icarus.voice_dock"]')) overlays.push('voice');
  if (document.getElementById('icarus-info-card')) overlays.push('info-card');
  if (document.getElementById('icarus-handoff')) overlays.push('ubot-card');
  if (document.getElementById('icarus-trade')) overlays.push('trade-card');

  // Lists that render with nothing in them: a section header whose list underneath has no text.
  const empties = [];
  const HEADERS = ['Recent Transactions', 'Recent Payments', 'Cards Transactions', 'Holdings', 'Transaction history', 'Explore Assets', 'Questions asked', 'Friction signals'];
  for (const el of document.querySelectorAll('div')) {
    if (el.childElementCount !== 0) continue;
    const text = (el.textContent ?? '').trim();
    if (!HEADERS.includes(text)) continue;
    const column = el.closest('[data-screen-label]:not([data-screen-label="Phone"])');
    let row = el;
    if (column) {
      while (row.parentElement && row.parentElement !== column) row = row.parentElement;
    }
    const list = column ? row.nextElementSibling : el.nextElementSibling;
    if (list && (list.innerText ?? '').trim() === '' && list.getBoundingClientRect().height < 400) {
      // The selected filter chip on Invest is the pink one.
      const filter = [...document.querySelectorAll('[data-screen-label="Invest"] div')].find((d) => d.childElementCount === 0 && ['All', 'Crypto', 'Stocks', 'Gold'].includes((d.textContent ?? '').trim()) && getComputedStyle(d).backgroundColor === 'rgb(201, 79, 114)');
      empties.push({ header: text, screen, filter: text === 'Explore Assets' ? (filter?.textContent ?? '').trim() : '' });
    }
  }
  const lines = (document.body.innerText ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  return { screen, overlays, lines: [...new Set(lines)], empties };
}

const RULES = [
  { id: 'placeholder-label', severity: 'high', title: 'Design placeholder label on screen', test: (l) => /^(photo|logo|network logo|brand logo|image|avatar|icon|placeholder)$/i.test(l) },
  { id: 'placeholder-text', severity: 'high', title: 'Placeholder text (lorem/TODO/TBD)', test: (l) => /lorem|ipsum|\bTODO\b|\bTBD\b|\bFIXME\b|\bXXX\b|PLACEHOLDER/.test(l) },
  { id: 'broken-value', severity: 'high', title: 'Broken value (undefined, NaN, [object ...], template braces)', test: (l) => /\bundefined\b|\bNaN\b|\[object |\bInfinity\b|\{\{|\}\}|^null$/.test(l) },
  { id: 'dollar-amount', severity: 'high', title: 'Dollar amount in a baht app', test: (l) => /(^|[^A-Za-z])[-+]?\$\s?\d/.test(l) },
  { id: 'placeholder-name', severity: 'high', title: 'Placeholder name (John / John Doe), not the demo user', test: (l) => /\bJohn\b|JOHN DOE|จอห์น/.test(l) },
  {
    id: 'not-live', severity: 'high', title: 'Says prices are demo / not live / saved, while the backend reports live prices',
    test: (l, c) => c.pricesLive && /not live|demo prices?\b|prices? (shown )?(are|is) demo|demo market data|demo price|saved reference|demo, not live/i.test(l),
  },
  {
    id: 'fee-mismatch', severity: 'medium', title: 'Fee wording does not match the backend fee rule',
    test: (l, c) => c.feePct != null && c.feePct !== 1 && /\(1%\)|\b1% fee|fee is 1%|fee 1%|1 percent|฿1,010/i.test(l),
  },
  { id: 'scripted-fallback', severity: 'medium', title: 'A scripted demo answer was shown (backend did not answer)', test: (l) => /^Demo response$|Scripted demo answer|Mock answer, not checked/.test(l) },
  { id: 'presenter-copy', severity: 'low', title: 'Presenter wording visible to visitors ("Scenario A", "scenarios A-D")', test: (l) => /Scenario [A-D]\b|scenarios A\s?[–-]\s?D|Hackathon scenarios|starts timer|Speaks the Scenario/.test(l) },
  { id: 'developer-text', severity: 'low', title: 'Developer notes visible in the side console', test: (l) => /Icarus\.set(Backend|TTS)|pushTranscript|ui_actions|^UI ids:|^Actions: navigate/.test(l) },
  { id: 'usd-wallet', severity: 'low', title: 'USD / USDT shown although the demo account is baht only', test: (l, c) => c.thbOnly && c.screen !== 'Dashboard' && /\bUSDT?\b/.test(l) && !/USDT \(Tether\)/.test(l) },
];

/** Run the scan on a page. Returns findings: { rule, severity, title, text, screen, overlays }. */
async function scanPage(page, context = {}) {
  const snap = await page.evaluate(collect);
  const out = [];
  const ctx = { ...context, screen: snap.screen };
  for (const line of snap.lines) {
    if (line.length > 400) continue; // a whole paragraph of chat: still scanned by its own lines
    for (const r of RULES) {
      if (r.test(line, ctx)) out.push({ rule: r.id, severity: r.severity, title: r.title, text: line.slice(0, 160), screen: snap.screen, overlays: snap.overlays.join('+') });
    }
  }
  for (const e of snap.empties) {
    out.push({ rule: 'empty-list', severity: 'medium', title: 'Empty list on screen', text: `"${e.header}" has nothing under it${e.filter ? ` (filter: ${e.filter})` : ''}`, screen: e.screen, overlays: snap.overlays.join('+') });
  }
  return out;
}

module.exports = { scanPage, RULES, collect };
