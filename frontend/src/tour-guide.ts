// The mascot that flies around the screen during the tour. It goes to whatever the tour is talking about, points at
// it with a dotted trail that ends in a heart, says its line in a bubble (in step with the voice), and throws hearts
// when something good happens. At the end it flies into the Icarus button, where it lives.
//
// It mirrors the app's own state (the voice window's line and the element the app highlights), so the tour script
// doesn't change. The app's voice window is hidden while the guide is out.

export interface GuideVoice {
  phase?: string;
  transcript?: string;
  you?: string;
  line?: string;
  said?: number;
  emotion?: string;
}

/** The prototype's component, as far as the guide reads it. */
export interface GuideHost {
  state: { voice?: GuideVoice | null; flash?: string | null };
}

type Target = string | Element | null;

const PINK = '#C94F72';
const SOFT = '#F7D2DC';
const INK = '#4A2E36';
const FONT = 'Fredoka,Mali,system-ui,sans-serif';
const POSES = ['curious', 'excited', 'flying', 'happy', 'hero', 'star', 'working'] as const;
const img = (pose: string) => `mascot/bow/${pose}.png`;
const MOOD: Record<string, string> = { happy: 'happy', excited: 'excited', curious: 'curious', thinking: 'working' };

const CSS = `
@keyframes icBob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-7px) } }
@keyframes icLand { 0% { transform: scale(1.1,.88) } 45% { transform: scale(.95,1.06) } 100% { transform: scale(1,1) } }
@keyframes icWiggle { 0%,100% { transform: rotate(0) } 25% { transform: rotate(-7deg) } 75% { transform: rotate(7deg) } }
@keyframes icHeart { 0% { transform: translate(0,0) scale(.5); opacity: 0 } 15% { opacity: 1 } 100% { transform: translate(var(--dx), -140px) scale(1.15); opacity: 0 } }
@keyframes icDash { to { stroke-dashoffset: -24 } }
@keyframes icBeat { 0%,100% { transform: scale(1) } 50% { transform: scale(1.25) } }
@keyframes icPopIn { from { transform: scale(.85); opacity: 0 } to { transform: scale(1); opacity: 1 } }
@keyframes icDots { 0%,80%,100% { opacity: .25 } 40% { opacity: 1 } }
body.ic-touring [data-ui-id="icarus.voice_dock"] { opacity: 0 !important; pointer-events: none !important; }
.ic-guide-mascot { position: fixed; left: 0; top: 0; z-index: 9450; pointer-events: none;
  transition: transform .85s cubic-bezier(.45,-0.3,.35,1.3), opacity .3s; will-change: transform; }
.ic-guide-bob { animation: icBob 1.8s ease-in-out infinite; }
.ic-guide-img { display: block; width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 8px 14px rgba(150,60,85,.28)); }
.ic-guide-land { animation: icLand .45s ease-out; }
.ic-guide-wiggle { animation: icWiggle .5s ease-in-out 2; }
.ic-guide-bubble { position: fixed; z-index: 9460; pointer-events: none; box-sizing: border-box; background: #FFF7F9;
  border: 2px solid ${SOFT}; border-radius: 22px; padding: 10px 14px; color: ${INK}; font: 500 15px/1.4 ${FONT};
  box-shadow: 0 10px 28px rgba(150,60,85,.22); transition: left .5s ease, top .5s ease, opacity .25s; }
.ic-guide-ask { position: fixed; z-index: 9460; pointer-events: none; box-sizing: border-box; display: flex; gap: 8px;
  align-items: center; background: #fff; border: 2px solid ${SOFT}; border-radius: 999px; padding: 7px 14px 7px 8px;
  color: ${INK}; font: 500 14px/1.3 ${FONT}; box-shadow: 0 6px 18px rgba(150,60,85,.18); transition: opacity .25s; }
.ic-guide-heart { position: fixed; z-index: 9470; pointer-events: none; width: 22px; height: 22px; animation: icHeart 1.4s ease-out forwards; }
.ic-guide-dot { display: inline-block; width: 7px; height: 7px; margin: 0 2px; border-radius: 50%; background: ${PINK}; animation: icDots 1s infinite; }
`;

const HEART_PATH = 'M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 5.3 3.1 1.7-1.9 3.2-3.1 5.3-3.1 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z';
const MIC = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, css = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (css) e.style.cssText = css;
  return e;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, hi < lo ? lo : v));

export interface Guide {
  /** Come out and follow the host's voice window and highlights. */
  start: (host: GuideHost) => void;
  /** Go away and give the app its voice window back. */
  stop: () => void;
  /** Point at a target (a data-ui-id, or an element) until the host highlights something else. */
  pointAt: (target: Target) => void;
  /** A little burst of hearts. */
  celebrate: () => void;
  /** Fly into the Icarus button (bottom right of the phone) and disappear. */
  goHome: () => Promise<void>;
}

export function createGuide(getPhone: () => Element | null): Guide {
  if (!document.getElementById('ic-guide-css')) {
    const style = document.createElement('style');
    style.id = 'ic-guide-css';
    style.textContent = CSS;
    document.head.append(style);
  }
  for (const p of POSES) new Image().src = img(p); // no flicker when the pose changes

  const mascot = el('div', 'ic-guide-mascot', 'opacity:0');
  const bob = el('div', 'ic-guide-bob', 'width:100%;height:100%');
  const flip = el('div', '', 'width:100%;height:100%;transition:transform .3s');
  const pose = el('img', 'ic-guide-img');
  pose.alt = '';
  flip.append(pose);
  bob.append(flip);
  mascot.append(bob);

  const bubble = el('div', 'ic-guide-bubble', 'opacity:0');
  const spoken = el('span', '');
  const rest = el('span', '', 'color:#D9B8C2');
  const dots = el('span', '', 'display:none');
  dots.innerHTML = '<i class="ic-guide-dot"></i><i class="ic-guide-dot" style="animation-delay:.15s"></i><i class="ic-guide-dot" style="animation-delay:.3s"></i>';
  bubble.append(spoken, rest, dots);

  const ask = el('div', 'ic-guide-ask', 'opacity:0');
  const micBadge = el('span', '', `display:inline-flex;width:26px;height:26px;border-radius:50%;background:${PINK};align-items:center;justify-content:center;flex:none`);
  micBadge.innerHTML = MIC;
  const askText = el('span', '', 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis');
  ask.append(micBadge, askText);

  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('style', 'position:fixed;inset:0;width:100vw;height:100vh;z-index:9440;pointer-events:none;overflow:visible');
  const trail = document.createElementNS(svgNs, 'path');
  trail.setAttribute('fill', 'none');
  trail.setAttribute('stroke', '#E97A9A');
  trail.setAttribute('stroke-width', '3.5');
  trail.setAttribute('stroke-linecap', 'round');
  trail.setAttribute('stroke-dasharray', '1 11');
  trail.setAttribute('style', 'animation:icDash .6s linear infinite;transition:opacity .25s');
  const ring = document.createElementNS(svgNs, 'rect');
  ring.setAttribute('fill', 'none');
  ring.setAttribute('stroke', PINK);
  ring.setAttribute('stroke-width', '3');
  ring.setAttribute('rx', '18');
  const heart = document.createElementNS(svgNs, 'g');
  const heartShape = document.createElementNS(svgNs, 'path');
  heartShape.setAttribute('d', HEART_PATH);
  heartShape.setAttribute('fill', PINK);
  heartShape.setAttribute('style', 'transform-origin:12px 12px;animation:icBeat .9s ease-in-out infinite');
  heart.append(heartShape);
  svg.append(trail, ring, heart);

  let host: GuideHost | null = null;
  let timer = 0;
  let target: Target = null;
  let lastFlash: string | null = null;
  let lastPos = { x: -999, y: -999 };
  let flyingUntil = 0;
  let celebratedLine = '';
  let size = 112;

  const resolve = (t: Target): Element | null => {
    if (!t) return null;
    if (typeof t !== 'string') return t.isConnected ? t : null;
    return document.querySelector(`[data-ui-id="${CSS_ESCAPE(t)}"]`);
  };

  const visible = (r: DOMRect, phone: DOMRect) =>
    r.width > 0 && r.height > 0 && r.bottom > phone.top + 30 && r.top < phone.bottom - 30;

  function setPose(name: string) {
    const src = img(name);
    if (!pose.src.endsWith(src)) pose.src = src;
  }

  function moveTo(x: number, y: number, faceLeft: boolean) {
    if (Math.abs(x - lastPos.x) < 6 && Math.abs(y - lastPos.y) < 6) return;
    const far = Math.hypot(x - lastPos.x, y - lastPos.y) > 40;
    lastPos = { x, y };
    mascot.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    flip.style.transform = faceLeft ? 'scaleX(-1)' : 'none';
    if (far) {
      flyingUntil = Date.now() + 850;
      window.setTimeout(() => {
        flip.classList.remove('ic-guide-land');
        void flip.offsetWidth; // restart the landing squash
        flip.classList.add('ic-guide-land');
      }, 830);
    }
  }

  function layout() {
    if (!host) return;
    const phoneEl = getPhone();
    const phone = phoneEl?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
    size = phone.width < 360 || innerWidth < 600 ? 86 : 112;
    mascot.style.width = mascot.style.height = `${size}px`;
    const outside = phone.left >= size + 70; // room beside the phone (desktop): stand there and point in

    const v = host.state.voice ?? {};
    const flash = host.state.flash ?? null;
    if (flash && flash !== lastFlash) target = flash;
    lastFlash = flash;

    const tEl = resolve(target);
    const t = tEl?.getBoundingClientRect();
    const tOk = t && visible(t, phone) ? t : null;

    // ---- where the mascot stands ----
    let x: number;
    let y: number;
    let faceLeft = false;
    if (tOk) {
      const cy = tOk.top + Math.min(tOk.height, 160) / 2;
      if (outside) {
        x = phone.left - size - 26;
        y = clamp(cy - size / 2, 64, innerHeight - size - 16);
      } else {
        // peek over the target's top-right corner
        x = clamp(tOk.right - size * 0.75, phone.left + 4, phone.right - size - 4);
        y = clamp(tOk.top - size * 0.72, phone.top + 44, phone.bottom - size - 70);
        faceLeft = true;
      }
    } else if (outside) {
      x = phone.left - size - 26;
      y = phone.top + phone.height * 0.32;
    } else {
      x = phone.right - size - 10;
      y = phone.top + phone.height * 0.42;
      faceLeft = true;
    }
    moveTo(x, y, faceLeft);

    // ---- the trail and heart to the target ----
    if (tOk && Date.now() > flyingUntil) {
      const from = outside
        ? { x: x + size - 10, y: y + size * 0.6 }
        : { x: x + size * 0.25, y: y + size * 0.7 };
      const to = outside
        ? { x: tOk.left + 10, y: clamp(tOk.top + Math.min(tOk.height, 120) / 2, tOk.top + 8, tOk.bottom - 8) }
        : { x: clamp(tOk.left + tOk.width * 0.55, tOk.left + 12, tOk.right - 12), y: tOk.top + 14 };
      const cx = (from.x + to.x) / 2;
      const cyc = Math.min(from.y, to.y) - 46;
      trail.setAttribute('d', `M${from.x},${from.y} Q${cx},${cyc} ${to.x},${to.y}`);
      trail.style.opacity = '1';
      heart.setAttribute('transform', `translate(${to.x - 12},${to.y - 12})`);
      heart.style.opacity = '1';
      // The app draws its own highlight around its elements; draw one for anything else (like the U-Bot card).
      const own = typeof target !== 'string';
      ring.setAttribute('x', String(tOk.left - 6));
      ring.setAttribute('y', String(tOk.top - 6));
      ring.setAttribute('width', String(tOk.width + 12));
      ring.setAttribute('height', String(tOk.height + 12));
      ring.style.opacity = own ? '1' : '0';
    } else {
      trail.style.opacity = '0';
      heart.style.opacity = '0';
      ring.style.opacity = '0';
    }

    // ---- pose ----
    const phase = v.phase ?? '';
    if (Date.now() < flyingUntil) setPose('flying');
    else if (phase === 'hearing') setPose('curious');
    else if (phase === 'thinking') setPose('working');
    else setPose(MOOD[v.emotion ?? ''] ?? 'happy');

    // ---- the visitor's question, at the top of the phone ----
    const q = phase === 'hearing' ? v.transcript ?? '' : v.you ?? '';
    askText.textContent = q;
    ask.style.opacity = q ? '1' : '0';
    const askW = Math.min(phone.width - 36, 340);
    ask.style.maxWidth = `${askW}px`;
    ask.style.left = `${phone.left + (phone.width - Math.min(askW, ask.offsetWidth || askW)) / 2}px`;
    ask.style.top = `${phone.top + 54}px`;

    // ---- the bubble, in step with the voice ----
    const line = v.line ?? '';
    const said = Math.max(0, Math.min(line.length, v.said ?? 0));
    const talking = phase === 'speaking' || (phase === 'listening' && line);
    if (phase === 'thinking') {
      spoken.textContent = '';
      rest.textContent = '';
      dots.style.display = 'inline';
      bubble.style.opacity = '1';
    } else if (talking && line) {
      dots.style.display = 'none';
      spoken.textContent = line.slice(0, said);
      rest.textContent = line.slice(said);
      bubble.style.opacity = '1';
      if (v.emotion === 'excited' && phase === 'speaking' && celebratedLine !== line) {
        celebratedLine = line;
        celebrate();
      }
    } else {
      bubble.style.opacity = '0';
    }
    const bw = outside ? Math.min(300, x + size + 40 - 12) : Math.min(phone.width - 28, 330);
    bubble.style.width = `${bw}px`;
    const bh = bubble.offsetHeight || 80;
    let bx: number;
    let by: number;
    if (outside) {
      bx = clamp(x + size + 40 - bw, 12, innerWidth - bw - 12);
      by = y - bh - 10 < 60 ? y + size + 8 : y - bh - 10;
    } else {
      bx = phone.left + (phone.width - bw) / 2;
      const low = y < phone.top + phone.height * 0.45; // mascot high: bubble low, and the other way round
      by = low ? phone.bottom - bh - 96 : phone.top + 100;
    }
    bubble.style.left = `${Math.round(bx)}px`;
    bubble.style.top = `${Math.round(by)}px`;
  }

  function celebrate() {
    const r = mascot.getBoundingClientRect();
    for (let i = 0; i < 9; i++) {
      const h = document.createElementNS(svgNs, 'svg');
      h.setAttribute('viewBox', '0 0 24 24');
      h.setAttribute('class', 'ic-guide-heart');
      const p = document.createElementNS(svgNs, 'path');
      p.setAttribute('d', HEART_PATH);
      p.setAttribute('fill', ['#F48FB1', PINK, '#FFC1D3'][i % 3] ?? PINK);
      h.append(p);
      h.style.left = `${r.left + r.width / 2 - 11 + (Math.random() - 0.5) * r.width * 0.6}px`;
      h.style.top = `${r.top + r.height * 0.35}px`;
      h.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 120)}px`);
      h.style.animationDelay = `${i * 70}ms`;
      document.body.append(h);
      window.setTimeout(() => h.remove(), 1700 + i * 70);
    }
    flip.classList.remove('ic-guide-wiggle');
    void flip.offsetWidth;
    flip.classList.add('ic-guide-wiggle');
  }

  return {
    start(h) {
      host = h;
      target = null;
      lastFlash = null;
      lastPos = { x: -999, y: -999 };
      document.body.classList.add('ic-touring');
      document.body.append(svg, mascot, bubble, ask);
      // Fly in from the top left corner.
      mascot.style.transition = 'none';
      mascot.style.transform = `translate(-160px, 40px)`;
      void mascot.offsetWidth;
      mascot.style.transition = '';
      mascot.style.opacity = '1';
      setPose('flying');
      flyingUntil = Date.now() + 900;
      timer = window.setInterval(layout, 90);
      layout();
    },
    stop() {
      window.clearInterval(timer);
      host = null;
      document.body.classList.remove('ic-touring');
      for (const e of [svg, mascot, bubble, ask]) e.remove();
      mascot.style.opacity = '0';
      bubble.style.opacity = '0';
      ask.style.opacity = '0';
    },
    pointAt(t) {
      target = t;
    },
    celebrate,
    async goHome() {
      window.clearInterval(timer);
      const phone = getPhone()?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
      bubble.style.opacity = '0';
      ask.style.opacity = '0';
      trail.style.opacity = '0';
      heart.style.opacity = '0';
      ring.style.opacity = '0';
      setPose('flying');
      flip.style.transform = 'none';
      mascot.style.transition = 'transform 1s cubic-bezier(.5,-0.4,.5,1), opacity .5s ease .7s';
      mascot.style.transform = `translate(${Math.round(phone.right - size * 0.75)}px, ${Math.round(phone.bottom - size - 70)}px) scale(.45)`;
      mascot.style.opacity = '0';
      await new Promise((r) => window.setTimeout(r, 1200));
      mascot.style.transition = '';
    },
  };
}

/** CSS.escape where it exists (all current browsers), else a minimal escape for the ids the app uses. */
function CSS_ESCAPE(s: string): string {
  const css = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS;
  return css?.escape ? css.escape(s) : s.replace(/["\\]/g, '\\$&');
}
