// The "U-Bot can help with this" card.
//
// The prototype's chat thread can show text, chips and a purchase card, but not a link. Oasis owns that
// design, so we do not edit it. Instead this card floats over the bottom of the phone. It is plain DOM, outside
// the prototype's React tree, so the prototype can re-render freely without removing it.
//
// The button is a real link (a genuine tap, so no popup blocker). U-Bot has no public deep link, so it opens the
// U-Bot front door. "Copy my question" lets the user paste their words there.

export interface HandoffInfo {
  label: string;
  message: string;
  url: string;
  question: string;
  reason: string;
}

const CARD_ID = 'icarus-handoff';

const COPY = {
  en: { title: 'U-Bot can help with this', copy: 'Copy my question', copied: 'Copied', dismiss: 'Not now', note: 'U-Bot opens in a new tab. You need to sign in there.' },
  th: { title: 'U-Bot ช่วยเรื่องนี้ได้', copy: 'คัดลอกคำถามของฉัน', copied: 'คัดลอกแล้ว', dismiss: 'ไว้ก่อน', note: 'U-Bot เปิดในแท็บใหม่ ต้องเข้าสู่ระบบที่นั่น' },
} as const;

let cleanup: (() => void) | null = null;

export function hideHandoffCard(): void {
  cleanup?.();
  cleanup = null;
  document.getElementById(CARD_ID)?.remove();
}

/** Show the card over the phone. `getPhone` returns the phone screen element (to place the card over it). */
export function showHandoffCard(info: HandoffInfo, options: { th: boolean; getPhone: () => Element | null }): HTMLElement {
  hideHandoffCard();
  const t = COPY[options.th ? 'th' : 'en'];

  const card = document.createElement('div');
  card.id = CARD_ID;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', t.title);
  card.style.cssText =
    'position:fixed;z-index:9000;box-sizing:border-box;padding:14px 16px 12px;border-radius:22px;background:#FFF7F9;color:#4A2E36;' +
    'border:1px solid #F7D2DC;box-shadow:0 12px 36px rgba(150,60,85,.28);font:500 13px/1.4 Fredoka,Mali,system-ui,sans-serif;' +
    'animation:icPop .28s ease';

  const title = document.createElement('div');
  title.textContent = t.title;
  title.style.cssText = 'font-weight:600;font-size:15px;color:#C94F72;margin-bottom:4px';

  const question = document.createElement('div');
  question.textContent = `“${info.question}”`;
  question.style.cssText = 'color:#8A6B75;margin-bottom:10px;max-height:2.8em;overflow:hidden';

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';

  const open = document.createElement('a');
  open.href = info.url;
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  open.textContent = info.label;
  open.style.cssText = 'background:#C94F72;color:#fff;border-radius:18px;padding:9px 16px;text-decoration:none;font-weight:600';

  const button = (text: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.style.cssText = 'font:inherit;background:#fff;color:#4A2E36;border:1px solid #F2DCE2;border-radius:18px;padding:8px 13px;cursor:pointer';
    return b;
  };
  const copy = button(t.copy);
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(info.question);
      copy.textContent = t.copied;
    } catch {
      copy.textContent = info.question; // no clipboard access: show the words so they can be selected
    }
  };
  const dismiss = button(t.dismiss);
  dismiss.onclick = hideHandoffCard;

  const note = document.createElement('div');
  note.textContent = t.note;
  note.style.cssText = 'font-size:11px;color:#AE939B;margin-top:8px';

  row.append(open, copy, dismiss);
  card.append(title, question, row, note);
  document.body.appendChild(card);

  // Sit over the lower part of the phone, above the tab bar, and follow it if the window changes.
  const place = () => {
    const phone = options.getPhone();
    const r = phone?.getBoundingClientRect();
    if (!r || r.width === 0) {
      // No phone to line up with (small window or tests): a sensible spot at the bottom of the page.
      Object.assign(card.style, { left: '50%', transform: 'translateX(-50%)', width: 'min(360px, 92vw)', bottom: '64px' });
      return;
    }
    Object.assign(card.style, {
      left: `${r.left + 16}px`,
      width: `${r.width - 32}px`,
      bottom: `${Math.max(8, window.innerHeight - (r.bottom - 104))}px`,
      transform: 'none',
    });
  };
  place();
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, { passive: true });
  cleanup = () => {
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place);
  };
  return card;
}
