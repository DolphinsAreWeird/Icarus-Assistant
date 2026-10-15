// The trade preview card, when Icarus runs on the real backend (backend-bridge.ts).
//
// It shows the backend's numbers, copied from its prepare_trade result, never from the model's words (hard rule 3).
// The only way to trade is a tap on Confirm, which calls POST /trades/{preview_id}/confirm (hard rules 2 and 4).
// It floats over the phone like the U-Bot card: plain DOM outside the prototype's React tree.

import { STRINGS } from '../../voice/src/config/strings';
import { placeOverPhone } from './handoff-card';

const CARD_ID = 'icarus-trade';

// THAI REVIEW: every Thai line below.
const COPY = {
  en: {
    buy: 'Buy {asset}', sell: 'Sell {asset}',
    rows: { buy: ['Into {asset}', 'Fee', 'You pay'], sell: ['You sell', 'Fee', 'You get'] },
    demoFee: 'demo fee', qty: 'About {qty} {unit} at {price} per {unit}',
    freshness: { live: 'Live price', delayed: 'Delayed price', offline: 'Price from the saved snapshot' } as Record<string, string>,
    held: 'Price held for {time}', confirm: 'Confirm', cancel: 'Cancel', busy: 'Confirming…',
    expired: 'This price has expired. Ask Icarus again for a fresh one.', failed: 'Could not confirm. Nothing changed.',
    done: 'Done. Cash left: {cash}.',
    saidBuy: 'Done. You bought {qty} {unit} of {asset} for {total}. Cash left: {cash}.',
    saidSell: 'Done. You sold {qty} {unit} of {asset} and got {total}. Cash left: {cash}.',
    money: '{n} THB',
  },
  th: {
    buy: 'ซื้อ{asset}', sell: 'ขาย{asset}',
    rows: { buy: ['ซื้อ{asset}', 'ค่าธรรมเนียม', 'จ่ายทั้งหมด'], sell: ['ขาย', 'ค่าธรรมเนียม', 'ได้รับ'] },
    demoFee: 'ค่าธรรมเนียมจำลอง', qty: 'ประมาณ {qty} {unit} ที่ราคา {price} ต่อ {unit}',
    freshness: { live: 'ราคาสด', delayed: 'ราคาล่าช้า', offline: 'ราคาจากข้อมูลที่บันทึกไว้' } as Record<string, string>,
    held: 'ล็อกราคาไว้ {time}', confirm: 'ยืนยัน', cancel: 'ยกเลิก', busy: 'กำลังยืนยัน…',
    expired: 'ราคานี้หมดเวลาแล้ว ถาม Icarus ใหม่อีกครั้งนะ', failed: 'ยืนยันไม่สำเร็จ ยังไม่มีอะไรเปลี่ยน',
    done: 'เรียบร้อย เงินสดคงเหลือ {cash}',
    saidBuy: 'เรียบร้อย ซื้อ{asset} {qty} {unit} ราคา {total} เงินสดคงเหลือ {cash}',
    saidSell: 'เรียบร้อย ขาย{asset} {qty} {unit} ได้รับ {total} เงินสดคงเหลือ {cash}',
    money: '{n} บาท',
  },
} as const;

const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_m, k: string) => v[k] ?? '');

export interface TradeCardOptions {
  lang: 'en' | 'th';
  backendUrl: string;
  userId: string;
  getPhone: () => Element | null;
  fetchImpl?: typeof fetch;
  /** After a confirm: the backend's result and a sentence for the chat. */
  onConfirmed?: (result: Record<string, unknown>, sentence: string) => void;
  log?: (type: string, data?: Record<string, unknown>) => void;
}

let cleanup: (() => void) | null = null;

export function hideTradeCard(): void {
  cleanup?.();
  cleanup = null;
  document.getElementById(CARD_ID)?.remove();
}

/** `card` is the backend's trade_preview data, after withReadbackFields (amount, fee, total). */
export function showTradeCard(card: Record<string, unknown>, o: TradeCardOptions): HTMLElement {
  hideTradeCard();
  const t = COPY[o.lang];
  const side = card.side === 'sell' ? 'sell' : 'buy';
  const assetId = String(card.asset_id ?? '');
  const asset = o.lang === 'th' ? STRINGS.th.assetNames[assetId] ?? String(card.asset_name ?? assetId) : String(card.asset_name ?? assetId);
  const shortAsset = STRINGS[o.lang].assetNames[assetId] ?? asset;
  const money = (n: unknown) => fill(t.money, { n: Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) });
  const unit = String(card.unit ?? '');
  const qty = String(card.qty ?? '');

  const el = document.createElement('div');
  el.id = CARD_ID;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', fill(t[side], { asset }));
  el.style.cssText =
    'position:fixed;z-index:9001;box-sizing:border-box;padding:14px 16px 12px;border-radius:22px;background:#FFF7F9;color:#4A2E36;' +
    'border:1px solid #F7D2DC;box-shadow:0 12px 36px rgba(150,60,85,.28);font:500 13px/1.45 Fredoka,Mali,system-ui,sans-serif';

  const line = (text: string, css: string) => {
    const d = document.createElement('div');
    d.textContent = text;
    d.style.cssText = css;
    return d;
  };
  const title = line(fill(t[side], { asset }), 'font-weight:600;font-size:15px;color:#C94F72;margin-bottom:6px');
  const rows = document.createElement('div');
  const labels = t.rows[side];
  const values = [money(card.amount), `${money(card.fee)}${card.fee_is_mock ? ` (${t.demoFee})` : ''}`, money(card.total)];
  labels.forEach((label, i) => {
    const row = document.createElement('div');
    row.style.cssText = `display:flex;justify-content:space-between;gap:12px;${i === 2 ? 'font-weight:600;border-top:1px solid #F2DCE2;padding-top:4px;margin-top:2px' : ''}`;
    row.append(line(fill(label, { asset: shortAsset }), ''), line(values[i] ?? '', 'text-align:right'));
    rows.append(row);
  });
  const detail = line(
    `${fill(t.qty, { qty, unit, price: money(card.price_thb) })} · ${t.freshness[String(card.freshness)] ?? String(card.freshness ?? '')}`,
    'font-size:11.5px;color:#8A6B75;margin-top:6px',
  );
  const status = line('', 'font-size:12px;color:#8A6B75;margin-top:6px;min-height:1.2em');

  const buttons = document.createElement('div');
  buttons.style.cssText = 'display:flex;gap:8px;margin-top:8px';
  const button = (text: string, primary: boolean) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.style.cssText = primary
      ? 'font:inherit;font-weight:600;flex:1;background:#C94F72;color:#fff;border:0;border-radius:18px;padding:9px 16px;cursor:pointer'
      : 'font:inherit;background:#fff;color:#4A2E36;border:1px solid #F2DCE2;border-radius:18px;padding:8px 13px;cursor:pointer';
    return b;
  };
  const confirm = button(t.confirm, true);
  const cancel = button(t.cancel, false);
  buttons.append(confirm, cancel);
  el.append(title, rows, detail, status, buttons);
  document.body.appendChild(el);
  const stopPlacing = placeOverPhone(el, o.getPhone);

  // The backend holds the price for a short time. Show it, and stop offering Confirm when it is gone.
  let left = Number(card.expires_in_s ?? 120);
  const tick = () => {
    if (left <= 0) {
      status.textContent = t.expired;
      confirm.disabled = true;
      confirm.style.opacity = '.5';
      window.clearInterval(timer);
      return;
    }
    status.textContent = fill(t.held, { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` });
    left -= 1;
  };
  const timer = window.setInterval(tick, 1000);
  tick();
  cleanup = () => {
    window.clearInterval(timer);
    stopPlacing();
  };

  o.log?.('preview_shown', { asset: assetId, side, preview_id: card.preview_id, source: 'backend' });
  cancel.onclick = async () => {
    confirm.disabled = cancel.disabled = true;
    const fetchImpl = o.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    try {
      const response = await fetchImpl(`${o.backendUrl}/trades/${encodeURIComponent(String(card.preview_id))}/cancel`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user_id: o.userId }),
      });
      if (!response.ok) throw new Error('Cancellation failed');
      o.log?.('trade_cancelled', { preview_id: card.preview_id });
      hideTradeCard();
    } catch {
      status.textContent = t.failed;
      cancel.disabled = false;
    }
  };
  confirm.onclick = async () => {
    confirm.disabled = cancel.disabled = true;
    window.clearInterval(timer);
    status.textContent = t.busy;
    const fetchImpl = o.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    try {
      const res = await fetchImpl(`${o.backendUrl}/trades/${encodeURIComponent(String(card.preview_id))}/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_id: o.userId }),
      });
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok || !body || body.status !== 'confirmed') {
        const detail = (body?.detail ?? null) as Record<string, unknown> | null;
        const message = detail?.[o.lang === 'th' ? 'message_th' : 'message_en'];
        status.textContent = typeof message === 'string' ? message : t.failed;
        status.style.color = '#C0332B';
        cancel.disabled = false;
        return;
      }
      const tx = (body.transaction ?? {}) as Record<string, unknown>;
      const cash = money(body.cash_thb);
      status.textContent = fill(t.done, { cash });
      status.style.color = '#2E7D4F';
      buttons.style.display = 'none';
      o.log?.('trade_confirmed', { preview_id: card.preview_id, transaction: tx.id });
      o.onConfirmed?.(body, fill(side === 'sell' ? t.saidSell : t.saidBuy, { qty: String(tx.qty ?? qty), unit, asset: shortAsset, total: money(card.total), cash }));
      window.setTimeout(hideTradeCard, 4000);
    } catch {
      status.textContent = t.failed;
      status.style.color = '#C0332B';
      cancel.disabled = false;
    }
  };
  return el;
}
