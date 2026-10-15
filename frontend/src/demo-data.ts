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
    const fee = Math.round(Math.max(total * bundle.fees.trading_fee_pct / 100, bundle.fees.min_fee_thb) * 100) / 100;
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
    if (!bundle) return view;
    const pf = proto.pfSummary(), current = bundle.assets[proto.state.assetId], stats = proto.chartStats(proto.state.assetId, proto.state.period);
    const calc = proto.calc(proto.state.assetId, Number(proto.state.buyAmount), 'thb');
    view.totalBal = proto.state.hideBal ? '••••••' : money(proto.state.thbBal + pf.value);
    view.cryptoBal = money(pf.value); view.spendBal = money(proto.state.thbBal);
    view.walletRows = view.walletRows.filter((w: any) => w.name === 'THB Wallet' || w.name === 'Investments');
    view.walletRows.forEach((w: any) => { if (w.name === 'Investments') { w.bal = money(pf.value); w.sub = 'BTC, ETH and PAX Gold · simulated'; } });
    view.pfValue = money(pf.value); view.pfChange = 'Current holdings · no portfolio return history';
    view.assetRows = view.assetRows.filter((a: any) => bundle!.assets[a.id]).map((a: any) => ({ ...a, price: money(bundle!.assets[a.id]!.price_thb), change: 'Saved reference' }));
    view.asset = { ...view.asset, price: current ? money(current.price_thb) : 'Unavailable', change24: 'Saved reference · approximate THB',
      pChange: `${stats.pct.toFixed(2)}%`, lo: money(stats.lo), hi: money(stats.hi), value: money((proto.state.hold[proto.state.assetId] ?? 0) * (current?.price_thb ?? 0)),
      perf: [], info: [{ k: 'Data', v: current?.freshness ?? 'unavailable' }, { k: 'Account', v: 'Simulated' }, { k: 'Gold proxy', v: 'PAXG' }],
      ...(proto.state.assetId === 'XAU' ? { name: 'PAX Gold', desc: 'Tokenized gold proxy (PAXG). Saved observations converted approximately to THB.' } : {}) };
    view.buy.unitPrice = `1 unit ≈ ${money(current?.price_thb ?? 0)}`;
    view.buy.fee = money(calc.fee); view.buy.total = money(calc.total); view.buy.amt = money(calc.amt);
    view.walletOpts = view.walletOpts.filter((w: any) => w.id === 'thb');
    view.allocList = view.allocList.map((a: any) => ({ ...a, value: a.value.replace('$', '฿'), change: 'Current valuation' }));
    for (const key of ['aChart', 'pfChart']) {
      if (view[key]) { view[key].val = view[key].val?.replace('$', '฿'); view[key].periods = view[key].periods.filter((p: any) => ['1D', '1W', '1M', '1Y'].includes(p.label)); }
    }
    view.txList = [];
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
        await refresh();
        proto.setState({ buyStep: 'done', lastBuy: { asset: proto.state.assetId, amt: preview.amount_thb - preview.fee_thb, fee: preview.fee_thb, total: preview.amount_thb, qty: preview.qty } });
      }
    } catch (error) { onError((error as Error).message); }
    finally { busy = false; }
  };
  proto.toReview = () => bundle ? manual(false) : onError('Wait for the demo account to load before trading.');
  proto.confirm = () => bundle ? manual(true) : onError('Wait for the demo account to load before trading.');
  return { refresh, ready: () => Boolean(bundle) };
}
