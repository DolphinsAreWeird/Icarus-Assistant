// Adapt the existing prototype at its public component boundary. Only ?backend opts in.
// The design export stays unchanged; backend screens use one simulated account and THB.
type Chart = { display_version: string; period: string; points: Array<{ at: string; price: string }>; source: { observed_at: string } };
type Asset = { price_thb: number; freshness: string; as_of?: string; charts: Record<string, Chart> };
export interface DemoBundle {
  mode: 'simulated'; currency: 'THB'; user_id: string; display_name: string; cash_thb: number;
  holdings: Record<string, number>; assets: Record<string, Asset>;
  fees: { trading_fee_pct: number; min_fee_thb: number; min_buy_thb: number };
  transactions: Array<{ id: string; type: string; asset_id: string | null; amount_thb: number; qty: number; ts: string }>;
  notice: string;
}

type Prototype = Record<string, any>; // The design runtime exports a dynamic logic class.
const money = (n: number) => `฿${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ids: Record<string, string> = { BTC: 'btc', ETH: 'eth', XAU: 'gold' };
const GREEN = '#1E9E55', RED = '#C8312E';
// For the account's history rows (the design's own asset badges).
const BADGES: Record<string, { name: string; mono: string; bg: string; unit: string }> = {
  BTC: { name: 'Bitcoin', mono: 'B', bg: '#F7931A', unit: 'BTC' },
  ETH: { name: 'Ethereum', mono: 'E', bg: '#627EEA', unit: 'ETH' },
  XAU: { name: 'PAX Gold', mono: 'Au', bg: '#C9A227', unit: 'PAXG' },
};
const day = (ts: string) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
// Same threshold as backend/app/config.py LIVE_MAX_AGE_S: a price older than this is "delayed", never "live".
export const LIVE_MAX_AGE_MS = 120_000;
export const REFRESH_INTERVAL_MS = 30_000;
const TICK_MS = 15_000;
const SKEW_MS = 300_000;
export type Aged = { state: 'live' | 'delayed' | 'offline'; age: number };
/**
 * The one place a server freshness label is aged. `receivedAt` is when we got the data (ms); `asOf` the server's
 * observation time. A price is at least as old as the time since we received it, whatever the clocks say (a future-dated
 * as_of can never make it look newer). The observation time can only make it older: always for delayed data, and for
 * "live" data unless it is implausibly old for a price the server just called live, which means our clock runs ahead.
 */
export function agedFreshness(freshness: string | undefined, asOf: string | undefined | null, receivedAt: number, now = Date.now()): Aged {
  if (freshness === 'offline') return { state: 'offline', age: 0 };
  const t = asOf ? Date.parse(asOf) : NaN;
  let age = Math.max(0, now - receivedAt);
  if (Number.isFinite(t) && (freshness !== 'live' || receivedAt - t < SKEW_MS)) age = Math.max(age, now - t);
  return { state: freshness === 'live' && age <= LIVE_MAX_AGE_MS ? 'live' : 'delayed', age };
}
export const ageLabel = (ms: number) => { const m = Math.floor(ms / 60_000); return m < 1 ? `${Math.max(1, Math.floor(ms / 1000))}s old` : m < 60 ? `${m} min old` : `${Math.floor(m / 60)} h old`; };
const signedPct = (p: number) => `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(2)}%`;

export function installDemoData(proto: Prototype, url: string, userId: string, onError: (message: string) => void, fetchImpl: typeof fetch = fetch) {
  let bundle: DemoBundle | null = null, fetchedAt = 0, inflight: Promise<void> | null = null;
  let revision = 0, signature = '', pending: Record<string, any> | null = null, busy = false, attempted = false;
  const matches = (p: Record<string, any>, state = proto.state) => state.tab === 'invest' && state.view === 'buy' && ids[state.assetId] === p.asset_id && Number(state.buyAmount) === p.amount_thb && state.walletId === 'thb';
  const valid = (p: Record<string, any>) => typeof p.preview_id === 'string' && p.side === 'buy' &&
    ['amount_thb', 'fee_thb', 'price_thb', 'qty', 'you_pay_thb', 'expires_at'].every(k => typeof p[k] === 'number' && Number.isFinite(p[k])) &&
    p.amount_thb > p.fee_thb && p.fee_thb >= 0 && p.price_thb > 0 && p.qty > 0 && p.you_pay_thb === p.amount_thb &&
    typeof p.unit === 'string' && (!p.user_id || p.user_id === userId) && (!p.status || p.status === 'pending');
  const stale = (p: Record<string, any>) => Date.now() / 1000 > p.expires_at;
  const invalidate = () => { pending = null; attempted = false; proto.setState({ buyStep: 'amount' }); };
  proto.reviewServerPreview = (preview: Record<string, any>) => {
    if (!valid(preview) || stale(preview)) { invalidate(); onError('Review a new server preview before confirming.'); return false; }
    proto.setState((state: any) => {
      if (!matches(preview, state)) {
        pending = null; attempted = false;
        onError('Review the amount again before confirming.');
        return { buyStep: 'amount' };
      }
      pending = Object.freeze({ ...preview }); attempted = false;
      return { buyStep: 'review' };
    });
    return true;
  };
  const setState = proto.setState.bind(proto);
  proto.setState = (patch: any, callback?: () => void) => setState((state: any, props: any) => {
    const next = typeof patch === 'function' ? patch(state, props) : patch;
    if (pending && next && (
      ['assetId', 'buyAmount', 'walletId'].some(k => k in next && String(next[k]) !== String(state[k])) ||
      ('buyStep' in next && next.buyStep !== 'review') || ('view' in next && next.view !== 'buy') || ('tab' in next && next.tab !== 'invest')
    )) { pending = null; attempted = false; }
    return next;
  }, callback);
  const doAction = proto.doAction.bind(proto);
  proto.doAction = (action: Record<string, any>) => {
    if (action.type === 'review') {
      if (action.preview) proto.reviewServerPreview(action.preview);
      else { invalidate(); void manual(false); }
      return 600;
    }
    return doAction(action);
  };
  const original = Object.fromEntries(['renderVals', 'getContext', 'calc', 'assetSeries', 'pfSummary', 'pfSeries', 'dateLabel'].map(k => [k, proto[k].bind(proto)]));
  const request = async (path: string, body?: unknown) => {
    const res = await fetchImpl(`${url}${path}`, { ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(data.detail?.message_en ?? 'Demo backend unavailable.'), { code: data.detail?.code });
    return data;
  };
  const chart = (id = proto.state.assetId, period = proto.state.period): Chart | undefined => bundle?.assets[id]?.charts[period];
  // Label from the observation time, so a "live" price degrades with the clock even when no refresh succeeds.
  const freshness = (a?: Asset) => a ? agedFreshness(a.freshness, a.as_of, fetchedAt) : { state: 'offline' as const, age: 0 };
  const load = async () => {
    const data = await request(`/demo/state/${encodeURIComponent(userId)}`) as DemoBundle;
    if (data.mode !== 'simulated' || data.currency !== 'THB' || data.user_id !== userId) throw new Error('Unsupported demo bundle.');
    // Check the whole shape first, and only then use any of it: a half-valid bundle must never be left half-applied.
    const assets = data.assets as Record<string, Asset> | undefined;
    if (!Array.isArray(data.transactions) || !data.fees || !Number.isFinite(data.fees.trading_fee_pct) || !Number.isFinite(data.fees.min_buy_thb)
      || !Number.isFinite(data.cash_thb) || !data.holdings || typeof data.holdings !== 'object' || !assets || typeof assets !== 'object'
      || Object.values(assets).some((a) => !a || !Number.isFinite(a.price_thb) || !a.charts || typeof a.charts !== 'object')) {
      throw new Error('Unsupported demo bundle: missing fields.');
    }
    bundle = data; fetchedAt = Date.now();
    const txs = data.transactions.filter(t => t.type === 'buy').map(t => ({ id: t.id, asset: Object.keys(ids).find(id => ids[id] === t.asset_id), thb: t.amount_thb, qty: t.qty, date: t.ts.slice(0, 10) })).filter(t => t.asset).reverse();
    proto.setState({ thbBal: data.cash_thb, usdBal: 0, hold: { ...data.holdings }, txs, walletId: 'thb' });
  };
  // One request at a time. A forced refresh (after a trade) waits for any earlier request, then fetches again,
  // because the earlier response may predate the trade.
  const refresh = (force = true): Promise<void> => {
    if (inflight && !force) return inflight;
    const run = async () => { if (inflight) await inflight.catch(() => {}); await load(); };
    const p: Promise<void> = run().finally(() => { if (inflight === p) inflight = null; });
    inflight = p;
    return p;
  };
  const reviewing = () => Boolean(pending && proto.state.buyStep === 'review');
  // Background refresh: never while a purchase is being reviewed or sent, so displayed terms cannot shift under the user.
  const background = () => {
    if (!bundle || busy || reviewing()) return;
    // A failed refresh keeps the last data; the re-render lets its label age.
    refresh(false).catch(() => proto.setState({ marketTick: Date.now() }));
  };
  const startAutoRefresh = (doc: Document = document, win: Window = window) => {
    const visible = () => doc.visibilityState !== 'hidden';
    const tick = () => { if (visible() && bundle) proto.setState({ marketTick: Date.now() }); };
    const wake = () => { if (visible()) { background(); tick(); } };
    const poll = win.setInterval(() => { if (visible()) background(); }, REFRESH_INTERVAL_MS);
    const age = win.setInterval(tick, TICK_MS);
    doc.addEventListener('visibilitychange', wake);
    win.addEventListener('focus', wake);
    win.addEventListener('online', wake);
    return () => { win.clearInterval(poll); win.clearInterval(age); doc.removeEventListener('visibilitychange', wake); win.removeEventListener('focus', wake); win.removeEventListener('online', wake); };
  };
  proto.assetSeries = (id: string, period: string, n?: number) => {
    if (!bundle) return original.assetSeries!(id, period, n);
    const points = chart(id, period)?.points ?? [];
    const values = points.map(p => Number(p.price));
    if (!values.length) return Array(n ?? 48).fill(bundle.assets[id]?.price_thb ?? 0);
    // Full charts use exact server points. Only sparklines may request fewer samples.
    return n && n < values.length ? Array.from({ length: n }, (_, i) => values[Math.round(i * (values.length - 1) / (n - 1))]) : values;
  };
  proto.chartStats = (id: string, period: string) => {
    const values = proto.assetSeries(id, period);
    return { start: values[0], end: values.at(-1), hi: Math.max(...values), lo: Math.min(...values), pct: values[0] ? (values.at(-1) / values[0] - 1) * 100 : 0 };
  };
  proto.pfSummary = () => {
    if (!bundle) return original.pfSummary!();
    const items = Object.entries(bundle.assets).map(([id, a]) => ({ id, name: id === 'XAU' ? 'PAX Gold' : id === 'BTC' ? 'Bitcoin' : 'Ethereum', qty: proto.state.hold[id] ?? 0, value: (proto.state.hold[id] ?? 0) * a.price_thb, pct: 0 }));
    const value = items.reduce((sum, i) => sum + i.value, 0);
    items.forEach(i => { i.pct = value ? i.value / value * 100 : 0; });
    return { value, items: items.filter(i => i.qty > 0).sort((a, b) => b.value - a.value) };
  };
  proto.pfSeries = (p: string, v: number) => bundle ? Array(48).fill(v) : original.pfSeries!(p, v);
  proto.dateLabel = (p: string, i: number, n: number) => {
    const points = chart()?.points;
    return bundle && points?.length ? points[Math.min(i, points.length - 1)]?.at.slice(0, 10) : original.dateLabel!(p, i, n);
  };
  proto.calc = (id: string, raw: number, wallet: string) => {
    const old = original.calc!(id, raw, wallet);
    if (!bundle) return old;
    if (pending && proto.state.buyStep === 'review' && matches(pending) && id === proto.state.assetId && Number(raw) === pending.amount_thb && wallet === 'thb') {
      return { ...old, amt: pending.amount_thb - pending.fee_thb, fee: pending.fee_thb, total: pending.you_pay_thb, qty: pending.qty, avail: proto.state.thbBal, ok: true, err: '' };
    }
    const total = Number(raw) || 0;
    const fee = Math.max(Math.round(Math.round(total * 100) * bundle.fees.trading_fee_pct / 100), Math.round(bundle.fees.min_fee_thb * 100)) / 100;
    const price = bundle.assets[id]?.price_thb;
    const avail = proto.state.thbBal;
    const ok = Number.isFinite(total) && total >= bundle.fees.min_buy_thb && total <= avail && Boolean(price) && wallet === 'thb';
    return { ...old, amt: Math.max(0, total - fee), fee, total, qty: price ? Math.round((total - fee) / price * 1e8) / 1e8 : 0, avail, ok,
      err: ok || !total ? '' : 'Use the THB wallet and a supported asset; check the minimum and available balance.' };
  };
  proto.getContext = () => {
    const ctx = original.getContext!();
    if (!bundle) return ctx;
    const selected = chart();
    const next = `${ctx.screen}:${ctx.asset.id}:${ctx.period}:${selected?.display_version ?? ''}`;
    if (next !== signature) { signature = next; revision++; }
    const pf = proto.pfSummary();
    return { ...ctx, currency: 'THB', data_source: 'backend_demo', screen_revision: `screen-${revision}`, display_version: selected?.display_version,
      asset: { id: ctx.asset.id, name: ctx.asset.name, price_thb: bundle.assets[ctx.asset.id]?.price_thb },
      portfolio: { value_thb: pf.value, cash_thb: proto.state.thbBal },
      chart: selected ? { start: Number(selected.points[0]?.price), end: Number(selected.points.at(-1)?.price), currency: 'THB' } : null };
  };
  proto.renderVals = () => {
    const view = original.renderVals!();
    if (!bundle) {
      // Until the account loads, show no numbers rather than the design's sample ones (dollars, another account).
      view.totalBal = view.cryptoBal = view.spendBal = '฿ …';
      view.pricesHeader = 'Loading prices…'; view.pricesNote = 'Loading prices; the account is a demo.'; view.buyNote = 'Loading prices; the account is a demo. The final quantity may differ slightly when the order fills.';
      view.assetRows = view.assetRows.map((a: any) => ({ ...a, price: '…', change: '' }));
      view.txList = [];
      return view;
    }
    const pf = proto.pfSummary(), current = bundle.assets[proto.state.assetId], stats = proto.chartStats(proto.state.assetId, proto.state.period);
    const calc = proto.calc(proto.state.assetId, Number(proto.state.buyAmount), 'thb');
    view.totalBal = proto.state.hideBal ? '••••••' : money(proto.state.thbBal + pf.value);
    view.cryptoBal = money(pf.value); view.spendBal = money(proto.state.thbBal);
    view.walletRows = view.walletRows.filter((w: any) => w.name === 'THB Wallet' || w.name === 'Investments');
    view.walletRows.forEach((w: any) => { if (w.name === 'Investments') { w.bal = money(pf.value); w.sub = 'BTC, ETH and PAX Gold · simulated'; } });
    const invested = Object.values(proto.state.hold as Record<string, number>).some(q => q > 0);
    view.pfValue = money(pf.value); const allLive = Object.values(bundle.assets).every(a => freshness(a).state === 'live');
    view.pfChange = invested ? (allLive ? 'Value at live prices' : 'Value at last known prices') : 'Nothing invested yet';
    // The change over the 1D chart the app shows (a % with its colour), instead of a placeholder label.
    const dayChange = (id: string) => { const s = proto.chartStats(id, '1D'); return Number.isFinite(s.pct) && s.start ? s.pct : null; };
    view.assetRows = view.assetRows.filter((a: any) => bundle!.assets[a.id]).map((a: any) => {
      const d = dayChange(a.id);
      return { ...a, price: money(bundle!.assets[a.id]!.price_thb), change: d === null ? (freshness(bundle!.assets[a.id]).state === 'live' ? 'Live' : 'Delayed') : `${signedPct(d)} 1D`, color: d === null || d >= 0 ? GREEN : RED };
    });
    const d24 = dayChange(proto.state.assetId);
    const fr = freshness(current), live = fr.state === 'live';
    const delayedText = fr.state === 'offline' ? 'Saved price' : `Delayed price · ${ageLabel(fr.age)}`;
    view.asset = { ...view.asset, price: current ? money(current.price_thb) : 'Unavailable',
      change24: `${live ? 'Live price' : delayedText}${d24 === null ? '' : ` · ${d24 >= 0 ? '▲' : '▼'} ${signedPct(d24)}`}`,
      chColor: d24 === null || d24 >= 0 ? GREEN : RED, chBg: d24 === null || d24 >= 0 ? '#E7F6EE' : '#FDECEC',
      pChange: `${stats.pct.toFixed(2)}%`, lo: money(stats.lo), hi: money(stats.hi), value: money((proto.state.hold[proto.state.assetId] ?? 0) * (current?.price_thb ?? 0)),
      perf: [], info: [{ k: 'Price', v: live ? 'Live, in baht' : fr.state === 'offline' ? 'Saved, in baht' : `Delayed, ${ageLabel(fr.age)}` }, { k: 'Account', v: 'Demo, yours only' }, ...(proto.state.assetId === 'XAU' ? [{ k: 'Gold token', v: 'PAXG' }] : [])],
      ...(proto.state.assetId === 'XAU' ? { name: 'PAX Gold', desc: 'PAX Gold (PAXG) is a token backed by real gold: one token is one troy ounce, shown here in baht.' } : {}) };
    // The swap starts from the THB wallet (judge-copy.ts LIVE_DATA_COPY puts these in the design).
    const btc = bundle.assets.BTC?.price_thb;
    view.swapBtc = btc ? (500 / btc).toFixed(6) : '–';
    view.btcThb = btc ? money(btc) : 'unavailable';
    // Screen-wide price wording (judge-copy.ts LIVE_DATA_COPY): the worst state across assets, re-evaluated on each render.
    const states = Object.values(bundle.assets).map(a => freshness(a).state);
    const worst = states.includes('offline') ? 'offline' : states.includes('delayed') ? 'delayed' : 'live';
    const word = { live: 'Live', delayed: 'Delayed', offline: 'Saved' }[worst];
    view.pricesHeader = `${word} prices, in baht`;
    view.pricesNote = `Prices are ${word.toLowerCase()}, in baht; the account is a demo.`;
    view.buyNote = `Prices are ${word.toLowerCase()}; the account is a demo. The final quantity may differ slightly when the order fills.`;
    const reviewed = pending && proto.state.buyStep === 'review' && matches(pending) ? pending : null;
    view.buy.unitPrice = reviewed ? `1 ${reviewed.unit} = ${money(reviewed.price_thb)}` : `1 unit ≈ ${money(current?.price_thb ?? 0)}`;
    view.buy.qty = reviewed ? `${reviewed.qty} ${reviewed.unit}` : `${Number(calc.qty).toFixed(8)} ${BADGES[proto.state.assetId]?.unit ?? ''}`;
    if (proto.state.assetId === 'XAU') {
      view.asset.qty = `${Number(proto.state.hold.XAU ?? 0).toFixed(8)} PAXG`;
      if (!reviewed) view.buy.qty = `${Number(calc.qty).toFixed(8)} PAXG`;
      if (proto.state.lastBuy?.asset === 'XAU') view.done.qty = `${Number(proto.state.lastBuy.qty).toFixed(8)} PAXG`;
    }
    view.buy.fee = money(calc.fee); view.buy.total = money(calc.total); view.buy.amt = money(calc.amt);
    view.walletOpts = view.walletOpts.filter((w: any) => w.id === 'thb');
    view.allocList = view.allocList.map((a: any) => ({ ...a, value: a.value.replace('$', '฿'), change: 'Current valuation' }));
    for (const key of ['aChart', 'pfChart']) {
      if (view[key]) { view[key].val = view[key].val?.replace('$', '฿'); view[key].periods = view[key].periods.filter((p: any) => ['1D', '1W', '1M', '1Y'].includes(p.label)); }
    }
    // The account's own history, newest first: the top-up it started with, then any buys and sells.
    view.txList = [...bundle.transactions].reverse().slice(0, 6).map((t, i) => {
      const border = i ? '1px solid #F8E8EC' : 'none';
      if (t.type === 'deposit') return { mono: '฿', bg: '#C94F72', fg: '#fff', title: 'Top up from bank', sub: `${day(t.ts)} • PromptPay`, amt: `+${money(t.amount_thb)}`, color: GREEN, border };
      const id = Object.keys(ids).find(k => ids[k] === t.asset_id) ?? '';
      const b = BADGES[id] ?? { name: id, mono: '•', bg: '#4A2E36', unit: id };
      const sell = t.type === 'sell';
      return { mono: b.mono, bg: b.bg, fg: '#fff', title: `${sell ? 'Sold' : 'Bought'} ${b.name}`, sub: `${day(t.ts)} • ${Number(t.qty ?? 0).toFixed(6)} ${b.unit}`,
        amt: `${sell ? '+' : '−'}${money(t.amount_thb)}`, color: sell ? GREEN : RED, border };
    });
    return view;
  };
  const manual = async (confirm: boolean) => {
    if (!bundle || busy) return;
    if (proto.state.guide) { proto.exitGuide(true); return; }
    busy = true;
    try {
      if (!confirm) {
        const amount = Number(proto.state.buyAmount), appAsset = proto.state.assetId;
        if (!proto.calc(appAsset, amount, 'thb').ok) throw new Error('Check the amount and available balance.');
        const preview = await request('/trades/preview', { user_id: userId, asset_id: ids[appAsset], amount_thb: amount });
        // Reject a late response if the user changed the order while it loaded.
        proto.reviewServerPreview(preview);
      } else {
        if (proto.state.buyStep !== 'review' || !pending || !matches(pending)) {
          invalidate(); throw new Error('Review the amount again before confirming.');
        }
        // An uncertain confirmation retries the same ID: it may already have executed.
        if (!attempted && stale(pending)) { invalidate(); throw new Error('Preview expired. Review a new server preview before confirming.'); }
        const preview = pending as Record<string, any>;
        attempted = true;
        const result = await request(`/trades/${encodeURIComponent(preview.preview_id)}/confirm`, { user_id: userId });
        if (result.status !== 'confirmed') throw new Error('Confirmation was not acknowledged. Retry the same preview.');
        const stillReviewed = pending === preview && matches(preview);
        if (stillReviewed) { pending = null; attempted = false; }
        if (stillReviewed) proto.setState({ buyStep: 'done', lastBuy: { asset: proto.state.assetId, amt: preview.amount_thb - preview.fee_thb, fee: preview.fee_thb, total: preview.amount_thb, qty: preview.qty } });
        finishTimer();
        await refresh();
      }
    } catch (error) {
      if (['preview_expired', 'preview_cancelled', 'preview_not_found'].includes((error as any).code)) invalidate();
      onError((error as Error).message);
    }
    finally { busy = false; }
  };
  proto.toReview = () => bundle ? manual(false) : onError('Wait for the demo account to load before trading.');
  proto.confirm = () => bundle ? manual(true) : onError('Wait for the demo account to load before trading.');
  const finishTimer = () => {
    if (!proto.state.timer) return;
    const timer = proto.state.timer, ms = Date.now() - timer.start;
    proto.setState({ results: { ...proto.state.results, [timer.mode]: ms }, timer: null });
    proto.log?.('timer', { mode: timer.mode, ms });
  };
  // The page may have rendered before these overrides were installed (blank price wording): show the loading state now.
  proto.setState({ marketTick: Date.now() });
  return { refresh, startAutoRefresh, freshness, ready: () => Boolean(bundle), confirmed: () => { finishTimer(); return refresh(true); } };
}
