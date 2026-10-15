// The backend's chart and step-by-step cards (card_type "chart" and "steps", backend/app/tools.py show_chart and
// show_steps). The prototype's chat cannot draw them, and Oasis owns its design, so like the trade card they float
// over the phone, outside the prototype's React tree. One of these cards at a time.
//
// Chart: one asset is its price in baht, two or three are compared in % from the start (so different prices fit one
// chart). The numbers are the backend's, from its price history; nothing is computed here except where to draw.

import { placeOverPhone } from './handoff-card';

const CARD_ID = 'icarus-info-card';
const SERIES_COLORS = ['#C04A6C', '#6F55BE', '#2A8392'];

// THAI REVIEW: the Thai words.
const COPY = {
  en: { close: 'Close', showMe: 'Show me', source: 'Source' },
  th: { close: 'ปิด', showMe: 'ให้ดู', source: 'ที่มา' },
} as const;

export interface ChartSeries {
  asset_id: string;
  name: string;
  points: Array<[string, number]>;
  change_pct?: number;
  change_text?: string;
}

export interface ChartCardData {
  title: string;
  period?: string;
  period_text?: string;
  unit: string;
  series: ChartSeries[];
  source?: string;
}

export interface StepsCardData {
  title: string;
  topic?: string;
  steps: Array<{ n: number; title: string; text: string; show_me?: Array<Record<string, unknown>> }>;
}

let cleanup: (() => void) | null = null;

export function hideInfoCard(): void {
  cleanup?.();
  cleanup = null;
  document.getElementById(CARD_ID)?.remove();
}

function shell(label: string, lang: 'en' | 'th', getPhone: () => Element | null) {
  hideInfoCard();
  const el = document.createElement('div');
  el.id = CARD_ID;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', label);
  el.style.cssText =
    'position:fixed;z-index:9001;box-sizing:border-box;padding:14px 16px 12px;border-radius:22px;background:#FFF7F9;color:#4A2E36;' +
    'border:1px solid #F7D2DC;box-shadow:0 12px 36px rgba(150,60,85,.28);font:500 13px/1.45 Fredoka,Mali,system-ui,sans-serif;' +
    'max-height:70vh;overflow:auto';
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:8px';
  const title = document.createElement('div');
  title.textContent = label;
  title.style.cssText = 'font-weight:600;font-size:15px;color:#C94F72';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = COPY[lang].close;
  close.style.cssText = 'font:inherit;background:#fff;color:#4A2E36;border:1px solid #F2DCE2;border-radius:14px;padding:3px 10px;cursor:pointer;flex:none';
  close.onclick = hideInfoCard;
  head.append(title, close);
  el.append(head);
  document.body.appendChild(el);
  cleanup = placeOverPhone(el, getPhone);
  return el;
}

/** "฿2.7M", "฿69k", "฿950" for baht; "+12%" for a change. */
export function axisLabel(value: number, unit: string): string {
  if (unit === '%') return `${value > 0 ? '+' : ''}${Math.round(value)}%`;
  const a = Math.abs(value);
  if (a >= 1_000_000) return `฿${(value / 1_000_000).toFixed(1)}M`;
  if (a >= 10_000) return `฿${Math.round(value / 1000)}k`;
  return `฿${Math.round(value).toLocaleString('en-US')}`;
}

function dateLabel(iso: string, period: string | undefined, lang: 'en' | 'th'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const locale = lang === 'th' ? 'th-TH' : 'en-GB';
  if (period === '1D') return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (period === '1W' || period === '1M') return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  return d.toLocaleDateString(locale, { month: 'short', year: 'numeric' });
}

/** The SVG for a chart card. Exported for tests. */
export function chartSvg(data: ChartCardData, lang: 'en' | 'th' = 'en'): SVGSVGElement {
  const W = 300, H = 150, L = 46, R = 8, T = 8, B = 22;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${data.title}. ${data.series.map((s) => `${s.name}: ${s.change_text ?? ''}`).join('. ')}`);
  const all = data.series.flatMap((s) => s.points.filter((p) => Array.isArray(p) && Number.isFinite(p[1])));
  if (all.length < 2) return svg;
  const times = all.map((p) => Date.parse(p[0])).filter(Number.isFinite);
  const t0 = Math.min(...times), t1 = Math.max(...times);
  let lo = Math.min(...all.map((p) => p[1])), hi = Math.max(...all.map((p) => p[1]));
  if (data.unit === '%') { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.05 || 1;
  lo -= pad; hi += pad;
  const x = (iso: string) => L + ((Date.parse(iso) - t0) / (t1 - t0 || 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text !== undefined) e.textContent = text;
    svg.append(e);
    return e;
  };
  // grid: top, middle, bottom, and zero for a % chart
  const ticks = data.unit === '%' ? [hi - pad, 0, lo + pad] : [hi - pad, (hi + lo) / 2, lo + pad];
  for (const v of ticks) {
    add('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: v === 0 && data.unit === '%' ? '#C9A9B4' : '#F2DCE2', 'stroke-width': 1 });
    add('text', { x: L - 4, y: y(v) + 3, 'text-anchor': 'end', 'font-size': 9, fill: '#8A6B75' }, axisLabel(v, data.unit));
  }
  const first = all.find((p) => Date.parse(p[0]) === t0)?.[0] ?? all[0]![0];
  const last = all.find((p) => Date.parse(p[0]) === t1)?.[0] ?? all[all.length - 1]![0];
  add('text', { x: L, y: H - 6, 'font-size': 9, fill: '#8A6B75' }, dateLabel(first, data.period, lang));
  add('text', { x: W - R, y: H - 6, 'text-anchor': 'end', 'font-size': 9, fill: '#8A6B75' }, dateLabel(last, data.period, lang));
  data.series.forEach((s, i) => {
    const pts = s.points.filter((p) => Array.isArray(p) && Number.isFinite(p[1]) && Number.isFinite(Date.parse(p[0])));
    if (pts.length < 2) return;
    const color = SERIES_COLORS[i % SERIES_COLORS.length] as string;
    add('path', { d: pts.map((p, j) => `${j ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(''), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    const end = pts[pts.length - 1]!;
    add('circle', { cx: x(end[0]).toFixed(1), cy: y(end[1]).toFixed(1), r: 2.6, fill: color });
  });
  return svg;
}

export function showChartCard(data: ChartCardData, o: { lang: 'en' | 'th'; getPhone: () => Element | null }): HTMLElement {
  const el = shell(data.period_text ? `${data.title} · ${data.period_text}` : data.title, o.lang, o.getPhone);
  el.append(chartSvg(data, o.lang));
  const legend = document.createElement('div');
  legend.style.cssText = 'display:grid;gap:2px;margin-top:6px';
  data.series.forEach((s, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center';
    const dot = document.createElement('span');
    dot.style.cssText = `width:10px;height:10px;border-radius:3px;flex:none;background:${SERIES_COLORS[i % SERIES_COLORS.length]}`;
    const name = document.createElement('span');
    name.textContent = s.name;
    name.style.fontWeight = '600';
    const change = document.createElement('span');
    change.textContent = s.change_text ?? '';
    change.style.cssText = 'margin-left:auto;color:#8A6B75';
    row.append(dot, name, change);
    legend.append(row);
  });
  el.append(legend);
  if (data.source) {
    const source = document.createElement('div');
    source.textContent = `${COPY[o.lang].source}: ${data.source}`;
    source.style.cssText = 'font-size:11px;color:#AE939B;margin-top:6px';
    el.append(source);
  }
  return el;
}

export function showStepsCard(data: StepsCardData, o: { lang: 'en' | 'th'; getPhone: () => Element | null; runActions: (actions: Array<Record<string, unknown>>) => void }): HTMLElement {
  const el = shell(data.title, o.lang, o.getPhone);
  const list = document.createElement('ol');
  list.style.cssText = 'margin:0;padding:0;list-style:none;display:grid;gap:8px';
  for (const step of data.steps) {
    const item = document.createElement('li');
    item.style.cssText = 'display:grid;grid-template-columns:22px 1fr auto;gap:8px;align-items:start';
    const n = document.createElement('span');
    n.textContent = String(step.n);
    n.style.cssText = 'width:22px;height:22px;border-radius:50%;background:#F8E1E8;color:#C04A6C;font-weight:700;display:grid;place-items:center;font-size:12px';
    const body = document.createElement('div');
    const t = document.createElement('div');
    t.textContent = step.title;
    t.style.fontWeight = '600';
    const d = document.createElement('div');
    d.textContent = step.text;
    d.style.color = '#6E5560';
    body.append(t, d);
    item.append(n, body);
    if (step.show_me?.length) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = COPY[o.lang].showMe;
      b.style.cssText = 'font:inherit;background:#C94F72;color:#fff;border:0;border-radius:14px;padding:4px 10px;cursor:pointer;white-space:nowrap';
      b.onclick = () => o.runActions(step.show_me ?? []);
      item.append(b);
    } else {
      item.append(document.createElement('span'));
    }
    list.append(item);
  }
  el.append(list);
  return el;
}
