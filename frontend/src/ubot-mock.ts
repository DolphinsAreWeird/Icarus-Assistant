// The U-Bot MOCK page: /app/?page=ubot&session=<id>, opened by "Open U-Bot" on a handoff (voice server UBOT_MODE=mock).
//
// A stand-in for U-Bot until U-topia shares an API. It carries on with what the user asked Icarus (the handoff
// carries the question over, which the real U-Bot's front door cannot do yet), shows SAMPLE options and a
// "Review & pay in U-topia Pay" step like U-Bot's own screens. It says on screen that it is a mock: nothing is
// booked and no money moves. No form fields: it never asks for payment details.

// THAI REVIEW: the Thai lines.
const COPY = {
  en: {
    subtitle: 'Handed over from Icarus',
    banner: 'This is a mock of U-Bot. U-topia has not shared an API yet, so the options and prices are samples. Nothing is booked and no money moves.',
    fromIcarus: 'From Icarus',
    sample: 'sample',
    thinking: 'U-Bot is thinking…',
    reviewTitle: 'Review & pay in U-topia Pay',
    total: 'Total (sample)',
    reviewNote: 'Mock: nothing is booked and no money moves.',
    pay: 'Pay with U-topia Pay (mock)',
    cancel: 'Cancel',
    paid: 'Done, in the mock. In the real U-Bot, U-topia Pay would now ask you to confirm the payment.',
    back: 'Back to Icarus',
    real: 'Open the real U-Bot',
    expired: 'This handoff has expired. Ask Icarus again.',
    failed: "The U-Bot mock can't be reached. Is the voice server running?",
  },
  th: {
    subtitle: 'ส่งต่อมาจาก Icarus',
    banner: 'นี่คือ U-Bot จำลอง ยูโทเปียยังไม่เปิด API จึงใช้ตัวเลือกและราคาตัวอย่าง ไม่มีการจองและไม่มีการโอนเงินจริง',
    fromIcarus: 'จาก Icarus',
    sample: 'ตัวอย่าง',
    thinking: 'U-Bot กำลังคิด…',
    reviewTitle: 'ตรวจสอบและจ่ายใน U-topia Pay',
    total: 'รวม (ตัวอย่าง)',
    reviewNote: 'จำลอง: ไม่มีการจองและไม่มีการโอนเงิน',
    pay: 'จ่ายด้วย U-topia Pay (จำลอง)',
    cancel: 'ยกเลิก',
    paid: 'เรียบร้อยในตัวจำลอง ใน U-Bot จริง U-topia Pay จะขอให้คุณยืนยันการจ่ายเงิน',
    back: 'กลับไปที่ Icarus',
    real: 'เปิด U-Bot ตัวจริง',
    expired: 'ลิงก์นี้หมดเวลาแล้ว ถาม Icarus ใหม่อีกครั้ง',
    failed: 'ติดต่อ U-Bot จำลองไม่ได้ เปิดเซิร์ฟเวอร์เสียงอยู่หรือเปล่า',
  },
} as const;

const REAL_UBOT = 'https://u.bot/';

interface Session { question: string; reason: string; language: 'en' | 'th' }
interface Option { title: string; detail: string; priceThb: number }
interface Reply { kind: string; text: string; options: Option[] }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  return e;
}

const baht = (n: number) => `฿${n.toLocaleString('en-US')}`;

export async function renderUbotMock(root: HTMLElement, o: { sessionId: string | null; fetchImpl?: typeof fetch }): Promise<void> {
  const fetchImpl = o.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  document.title = 'U-Bot (mock)';
  document.body.style.cssText = 'margin:0;background:#EEF0F7;font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1F2340';
  root.innerHTML = '';

  const phone = el('div', 'max-width:400px;margin:24px auto;background:#fff;border-radius:28px;box-shadow:0 12px 40px rgba(31,35,64,.18);overflow:hidden;display:flex;flex-direction:column;min-height:640px');
  phone.setAttribute('data-testid', 'ubot-mock');
  const header = el('div', 'background:#1F2340;color:#fff;padding:16px 18px');
  const titleRow = el('div', 'display:flex;align-items:center;gap:8px');
  titleRow.append(el('div', 'font-weight:700;font-size:20px', 'U-Bot'), el('span', 'background:#FFB547;color:#1F2340;font-size:11px;font-weight:700;border-radius:8px;padding:2px 7px', 'MOCK'));
  const subtitle = el('div', 'font-size:12.5px;opacity:.75;margin-top:2px');
  header.append(titleRow, subtitle);
  const banner = el('div', 'background:#FFF6E5;color:#7A5200;font-size:12px;padding:8px 18px');
  const thread = el('div', 'flex:1;padding:14px;display:flex;flex-direction:column;gap:10px;overflow:auto');
  const footer = el('div', 'display:flex;gap:10px;justify-content:space-between;padding:12px 16px;border-top:1px solid #E6E8F0;font-size:13px');
  const back = el('a', 'color:#6C5CE7;text-decoration:none;font-weight:600');
  back.href = '/app/';
  const real = el('a', 'color:#6B6F86;text-decoration:none');
  real.href = REAL_UBOT;
  real.target = '_blank';
  real.rel = 'noopener noreferrer';
  footer.append(back, real);
  phone.append(header, banner, thread, footer);
  root.append(phone);

  const setLang = (lang: 'en' | 'th') => {
    const t = COPY[lang];
    subtitle.textContent = t.subtitle;
    banner.textContent = t.banner;
    back.textContent = `← ${t.back}`;
    real.textContent = `${t.real} ↗`;
    return t;
  };
  let t = setLang('en');
  const botBubble = (text: string) => {
    const b = el('div', 'align-self:flex-start;max-width:85%;background:#F3F1FF;border-radius:16px 16px 16px 4px;padding:9px 12px', text);
    thread.append(b);
    return b;
  };

  // 1. The handed-over question.
  let session: Session;
  try {
    const res = await fetchImpl(`/mock/ubot/session/${encodeURIComponent(o.sessionId ?? '')}`);
    if (!o.sessionId || !res.ok) {
      botBubble(t.expired);
      return;
    }
    session = (await res.json()) as Session;
  } catch {
    botBubble(t.failed);
    return;
  }
  t = setLang(session.language === 'th' ? 'th' : 'en');
  const mine = el('div', 'align-self:flex-end;max-width:85%;display:flex;flex-direction:column;align-items:flex-end;gap:4px');
  mine.append(
    el('span', 'font-size:11px;color:#6B6F86;background:#EEF0F7;border-radius:8px;padding:2px 8px', t.fromIcarus),
    el('div', 'background:#6C5CE7;color:#fff;border-radius:16px 16px 4px 16px;padding:9px 12px', session.question),
  );
  thread.append(mine);

  // 2. U-Bot's (mock) answer.
  const thinking = botBubble(t.thinking);
  let reply: Reply;
  try {
    const res = await fetchImpl(`/mock/ubot/session/${encodeURIComponent(o.sessionId)}/reply`, { method: 'POST' });
    if (!res.ok) throw new Error(String(res.status));
    reply = (await res.json()) as Reply;
  } catch {
    thinking.textContent = t.failed;
    return;
  }
  thinking.textContent = reply.text;
  if (reply.options.length === 0) {
    real.style.cssText = 'color:#fff;background:#6C5CE7;border-radius:14px;padding:6px 12px;text-decoration:none;font-weight:600';
    return;
  }

  // 3. Sample options, then the review step.
  const list = el('div', 'display:flex;flex-direction:column;gap:8px');
  for (const option of reply.options) {
    const card = el('button', 'all:unset;cursor:pointer;display:flex;justify-content:space-between;gap:10px;border:1px solid #E6E8F0;border-radius:14px;padding:10px 12px;background:#fff');
    card.type = 'button';
    const left = el('div', '');
    left.append(el('div', 'font-weight:600', option.title), el('div', 'font-size:12.5px;color:#6B6F86', option.detail));
    const right = el('div', 'text-align:right;white-space:nowrap');
    right.append(el('div', 'font-weight:700', baht(option.priceThb)), el('div', 'font-size:11px;color:#A0A4B8', t.sample));
    card.append(left, right);
    card.onclick = () => review(option);
    list.append(card);
  }
  thread.append(list);

  let sheet: HTMLElement | null = null;
  function review(option: Option) {
    sheet?.remove();
    const s = el('div', 'border:2px solid #6C5CE7;border-radius:16px;padding:12px 14px;background:#FBFAFF');
    s.setAttribute('data-testid', 'ubot-review');
    const total = el('div', 'display:flex;justify-content:space-between;font-weight:700;border-top:1px solid #E6E8F0;margin-top:8px;padding-top:6px');
    total.append(el('span', '', t.total), el('span', '', baht(option.priceThb)));
    const buttons = el('div', 'display:flex;gap:8px;margin-top:10px');
    const pay = el('button', 'font:inherit;font-weight:600;flex:1;background:#6C5CE7;color:#fff;border:0;border-radius:14px;padding:9px 12px;cursor:pointer', t.pay);
    const cancel = el('button', 'font:inherit;background:#fff;color:#1F2340;border:1px solid #E6E8F0;border-radius:14px;padding:9px 12px;cursor:pointer', t.cancel);
    pay.type = cancel.type = 'button';
    pay.onclick = () => {
      buttons.replaceWith(el('div', 'margin-top:10px;color:#2E7D4F;font-weight:600', t.paid));
    };
    cancel.onclick = () => {
      s.remove();
      sheet = null;
    };
    buttons.append(pay, cancel);
    s.append(
      el('div', 'font-weight:700;color:#6C5CE7;margin-bottom:6px', t.reviewTitle),
      el('div', 'font-weight:600', option.title),
      el('div', 'font-size:12.5px;color:#6B6F86', option.detail),
      total,
      el('div', 'font-size:12px;color:#7A5200;margin-top:6px', t.reviewNote),
      buttons,
    );
    thread.append(s);
    sheet = s;
    s.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }
}
