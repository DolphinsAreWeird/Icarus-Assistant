// Adapt the existing prototype at its public component boundary. Only ?backend opts in.
// The design export stays unchanged; backend screens use one simulated account and THB.
type Chart = { display_version: string; period: string; points: Array<{ at: string; price: string }>; source: { observed_at: string } };
type Asset = { price_thb: number; freshness: string; charts: Record<string, Chart> };
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
const signedPct = (p: number) => `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(2)}%`;

export function installDemoData(proto: Prototype, url: string, userId: string, onError: (message: string) => void, fetchImpl: typeof fetch = fetch) {
  let bundle: DemoBundle | null = null;
  let revision = 0, signature = '', pending: Record<string, any> | null = null, busy = false;
  const original = Object.fromEntries(['renderVals', 'getContext', 'calc', 'assetSeries', 'pfSummary', 'pfSeries', 'dateLabel'].map(k => [k, proto[k].bind(proto)]));
  const request = async (path: string, body?: unknown) => {
    const res = await fetchImpl(`${url}${path}`, { ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail?.message_en ?? 'Demo backend unavailable.');
    return data;
  };
  const chart = (id = proto.state.assetId, period = proto.state.period): Chart | undefined => bundle?.assets[id]?.charts[period];
  const refresh = async () => {
    const data = await request(`/demo/state/${encodeURIComponent(userId)}`) as DemoBundle;
    if (data.mode !== 'simulated' || data.currency !== 'THB' || data.user_id !== userId) throw new Error('Unsupported demo bundle.');
    bundle = data;
    const txs = data.transactions.filter(t => t.type === 'buy').map(t => ({ id: t.id, asset: Object.keys(ids).find(id => ids[id] === t.asset_id), thb: t.amount_thb, qty: t.qty, date: t.ts.slice(0, 10) })).filter(t => t.asset).reverse();
    proto.setState({ thbBal: data.cash_thb, usdBal: 0, hold: { ...data.holdings }, txs, walletId: 'thb' });
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
    view.pfValue = money(pf.value); view.pfChange = invested ? 'Value at live prices' : 'Nothing invested yet';
    // The change over the 1D chart the app shows (a % with its colour), instead of a placeholder label.
    const dayChange = (id: string) => { const s = proto.chartStats(id, '1D'); return Number.isFinite(s.pct) && s.start ? s.pct : null; };
    view.assetRows = view.assetRows.filter((a: any) => bundle!.assets[a.id]).map((a: any) => {
      const d = dayChange(a.id);
      return { ...a, price: money(bundle!.assets[a.id]!.price_thb), change: d === null ? 'Live' : `${signedPct(d)} 1D`, color: d === null || d >= 0 ? GREEN : RED };
    });
    const d24 = dayChange(proto.state.assetId);
    const live = current?.freshness === 'live';
    view.asset = { ...view.asset, price: current ? money(current.price_thb) : 'Unavailable',
      change24: `${live ? 'Live price' : 'Delayed price'}${d24 === null ? '' : ` · ${d24 >= 0 ? '▲' : '▼'} ${signedPct(d24)} 1D`}`,
      pChange: `${stats.pct.toFixed(2)}%`, lo: money(stats.lo), hi: money(stats.hi), value: money((proto.state.hold[proto.state.assetId] ?? 0) * (current?.price_thb ?? 0)),
      perf: [], info: [{ k: 'Price', v: live ? 'Live, in baht' : 'Delayed' }, { k: 'Account', v: 'Demo, yours only' }, ...(proto.state.assetId === 'XAU' ? [{ k: 'Gold token', v: 'PAXG' }] : [])],
      ...(proto.state.assetId === 'XAU' ? { name: 'PAX Gold', desc: 'PAX Gold (PAXG) is a token backed by real gold: one token is one troy ounce, shown here in baht.' } : {}) };
    // The swap starts from the THB wallet (judge-copy.ts LIVE_DATA_COPY puts these in the design).
    const btc = bundle.assets.BTC?.price_thb;
    view.swapBtc = btc ? (500 / btc).toFixed(6) : '–';
    view.btcThb = btc ? money(btc) : 'unavailable';
    view.buy.unitPrice = `1 unit ≈ ${money(current?.price_thb ?? 0)}`;
    if (proto.state.assetId === 'XAU') {
      view.asset.qty = `${Number(proto.state.hold.XAU ?? 0).toFixed(8)} PAXG`;
      view.buy.qty = `${Number(calc.qty).toFixed(8)} PAXG`;
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
        pending = await request('/trades/preview', { user_id: userId, asset_id: ids[appAsset], amount_thb: amount });
        proto.setState({ buyStep: 'review' });
      } else {
        if (!pending || ids[proto.state.assetId] !== pending.asset_id || Number(proto.state.buyAmount) !== pending.amount_thb) throw new Error('Review the amount again before confirming.');
        const preview = pending;
        await request(`/trades/${encodeURIComponent(preview.preview_id)}/confirm`, { user_id: userId });
        pending = null;
        proto.setState({ buyStep: 'done', lastBuy: { asset: proto.state.assetId, amt: preview.amount_thb - preview.fee_thb, fee: preview.fee_thb, total: preview.amount_thb, qty: preview.qty } });
        finishTimer();
        await refresh();
      }
    } catch (error) { onError((error as Error).message); }
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
  return { refresh, ready: () => Boolean(bundle), confirmed: () => { finishTimer(); return refresh(); } };
}
