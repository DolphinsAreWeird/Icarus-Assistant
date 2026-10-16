// The mascot that flies around the screen during the tour.
//
//   It listens: when a question comes in, it flies up beside it.
//   It shows: it flies (in a curve, leaving sparkles) to whatever it talks about, and points at it: the screen dims
//   around it, a big arrow bounces at it, ripples tap on it, and a dotted trail runs back to the mascot.
//   It talks in a bubble, in step with the voice; hearts when something good happens; a different little trick
//   (hop, spin, wiggle) each time it lands; it switches sides of the phone so it moves across the screen.
//   At the end it loops back into the Icarus button, where it lives.
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
interface Pt { x: number; y: number }
interface Box { x: number; y: number; w: number; h: number }

const PINK = '#C94F72';
const SOFT = '#F7D2DC';
const INK = '#4A2E36';
const FONT = 'Fredoka,Mali,system-ui,sans-serif';
const POSES = ['curious', 'excited', 'flying', 'happy', 'hero', 'star', 'working'] as const;
const img = (pose: string) => `mascot/bow/${pose}.png`;
const MOOD: Record<string, string> = { happy: 'happy', excited: 'excited', curious: 'curious', thinking: 'working' };
const TRICKS = ['hop', 'spin', 'wiggle', 'hop', 'flip'] as const;

const CSS = `
@keyframes icBob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-8px) } }
@keyframes icHeart { 0% { transform: translate(0,0) scale(.5); opacity: 0 } 15% { opacity: 1 } 100% { transform: translate(var(--dx), -150px) scale(1.2); opacity: 0 } }
@keyframes icDash { to { stroke-dashoffset: -26 } }
@keyframes icDots { 0%,80%,100% { opacity: .25 } 40% { opacity: 1 } }
@keyframes icPoke { 0%,100% { transform: translateX(-16px) } 50% { transform: translateX(0) } }
@keyframes icRipple { from { transform: translate(-50%,-50%) scale(.3); opacity: .75 } to { transform: translate(-50%,-50%) scale(1.9); opacity: 0 } }
@keyframes icRing { 0%,100% { stroke-width: 4; opacity: 1 } 50% { stroke-width: 7; opacity: .55 } }
@keyframes icSpark { from { transform: translate(-50%,-50%) scale(1) rotate(0); opacity: 1 } to { transform: translate(-50%,-50%) scale(.2) rotate(120deg); opacity: 0 } }
@keyframes icHop { 0%,100% { transform: translateY(0) } 40% { transform: translateY(-34px) } 70% { transform: translateY(4px) } }
@keyframes icSpin { from { transform: rotate(0) } to { transform: rotate(360deg) } }
@keyframes icWiggle { 0%,100% { transform: rotate(0) } 20% { transform: rotate(-12deg) } 40% { transform: rotate(10deg) } 60% { transform: rotate(-8deg) } 80% { transform: rotate(6deg) } }
@keyframes icFlip { 0%,100% { transform: scaleX(1) } 50% { transform: scaleX(-1) } }
@keyframes icPop { 0% { transform: scale(.6); opacity: 0 } 100% { transform: scale(1); opacity: 1 } }
body.ic-touring [data-ui-id="icarus.voice_dock"] { opacity: 0 !important; pointer-events: none !important; }
.ic-g { position: fixed; left: 0; top: 0; pointer-events: none; }
.ic-g-mascot { z-index: 9450; will-change: transform; }
.ic-g-bob { animation: icBob 1.7s ease-in-out infinite; width: 100%; height: 100%; }
.ic-g-img { display: block; width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 10px 16px rgba(150,60,85,.3)); }
.ic-g-hop { animation: icHop .6s ease-out; } .ic-g-spin { animation: icSpin .7s ease-in-out; }
.ic-g-wiggle { animation: icWiggle .8s ease-in-out; } .ic-g-flip { animation: icFlip .6s ease-in-out; }
.ic-g-bubble { z-index: 9460; box-sizing: border-box; background: #FFF7F9; border: 2.5px solid ${SOFT}; border-radius: 22px;
  padding: 10px 15px; color: ${INK}; font: 500 15.5px/1.4 ${FONT}; box-shadow: 0 12px 30px rgba(150,60,85,.25); transition: opacity .25s; }
.ic-g-ask { z-index: 9460; box-sizing: border-box; display: flex; gap: 8px; align-items: center; background: #fff;
  border: 2.5px solid ${SOFT}; border-radius: 999px; padding: 7px 15px 7px 8px; color: ${INK}; font: 600 14.5px/1.3 ${FONT};
  box-shadow: 0 8px 20px rgba(150,60,85,.22); transition: opacity .25s; }
.ic-g-pointer { z-index: 9455; width: 64px; height: 64px; transition: opacity .2s; }
.ic-g-poke { width: 100%; height: 100%; animation: icPoke .75s ease-in-out infinite; }
.ic-g-ripple { z-index: 9445; width: 70px; height: 70px; border-radius: 50%; border: 4px solid ${PINK}; animation: icRipple 1.1s ease-out forwards; }
.ic-g-heart { z-index: 9470; width: 24px; height: 24px; animation: icHeart 1.4s ease-out forwards; }
.ic-g-spark { z-index: 9440; width: 18px; height: 18px; animation: icSpark .7s ease-out forwards; }
.ic-g-dot { display: inline-block; width: 7px; height: 7px; margin: 0 2px; border-radius: 50%; background: ${PINK}; animation: icDots 1s infinite; }
`;

const HEART = 'M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 5.3 3.1 1.7-1.9 3.2-3.1 5.3-3.1 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z';
const SPARK = 'M12 1.5 14.2 9.8 22.5 12 14.2 14.2 12 22.5 9.8 14.2 1.5 12 9.8 9.8z';
const MIC = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>';
// An arrow pointing right (+x); the wrapper turns it toward the target.
const ARROW = `<svg viewBox="0 0 64 64" width="64" height="64"><path d="M6 24h28V11l26 21-26 21V40H6z" fill="${PINK}" stroke="#fff" stroke-width="4" stroke-linejoin="round" style="filter:drop-shadow(0 4px 6px rgba(150,60,85,.35))"/></svg>`;

const NS = 'http://www.w3.org/2000/svg';
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi < lo ? lo : hi, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function div(className: string, css = ''): HTMLDivElement {
  const e = document.createElement('div');
  e.className = className;
  if (css) e.style.cssText = css;
  return e;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function roundRect(b: Box, r: number): string {
  const rr = Math.min(r, b.w / 2, b.h / 2);
  return `M${b.x + rr},${b.y}H${b.x + b.w - rr}A${rr},${rr} 0 0 1 ${b.x + b.w},${b.y + rr}V${b.y + b.h - rr}` +
    `A${rr},${rr} 0 0 1 ${b.x + b.w - rr},${b.y + b.h}H${b.x + rr}A${rr},${rr} 0 0 1 ${b.x},${b.y + b.h - rr}V${b.y + rr}A${rr},${rr} 0 0 1 ${b.x + rr},${b.y}Z`;
}

export interface Guide {
  /** Come out and follow the host's voice window and highlights. */
  start: (host: GuideHost) => void;
  /** Go away and give the app its voice window back. */
  stop: () => void;
  /** Point at a target (a data-ui-id, or an element) until the host highlights something else. */
  pointAt: (target: Target) => void;
  /** A burst of hearts and a spin. */
  celebrate: () => void;
  /** Loop back into the Icarus button (bottom right of the phone) and disappear. */
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

  // ---- the pieces ----
  const mascot = div('ic-g ic-g-mascot');
  const trick = div('', 'width:100%;height:100%');
  const bob = div('ic-g-bob');
  const pose = document.createElement('img');
  pose.className = 'ic-g-img';
  pose.alt = '';
  bob.append(pose);
  trick.append(bob);
  mascot.append(trick);

  const bubble = div('ic-g ic-g-bubble', 'opacity:0');
  const spoken = document.createElement('span');
  const rest = document.createElement('span');
  rest.style.color = '#D9B8C2';
  const dots = document.createElement('span');
  dots.innerHTML = '<i class="ic-g-dot"></i><i class="ic-g-dot" style="animation-delay:.15s"></i><i class="ic-g-dot" style="animation-delay:.3s"></i>';
  bubble.append(spoken, rest, dots);

  const ask = div('ic-g ic-g-ask', 'opacity:0');
  const micBadge = div('', `display:inline-flex;width:26px;height:26px;border-radius:50%;background:${PINK};align-items:center;justify-content:center;flex:none`);
  micBadge.innerHTML = MIC;
  const askText = document.createElement('span');
  askText.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  ask.append(micBadge, askText);

  const pointer = div('ic-g ic-g-pointer', 'opacity:0');
  const poke = div('ic-g-poke');
  poke.innerHTML = ARROW;
  pointer.append(poke);

  // The spotlight (dims everything but the target), its glowing ring, and the dotted trail.
  const svg = svgEl('svg', { style: 'position:fixed;inset:0;width:100vw;height:100vh;z-index:9430;pointer-events:none;overflow:visible' });
  const shade = svgEl('path', { fill: 'rgba(74,46,54,.34)', 'fill-rule': 'evenodd', style: 'transition:opacity .35s' });
  const ring = svgEl('path', { fill: 'none', stroke: PINK, 'stroke-width': '4', style: 'animation:icRing 1.1s ease-in-out infinite;filter:drop-shadow(0 0 8px rgba(233,122,154,.9))' });
  const trail = svgEl('path', { fill: 'none', stroke: '#F48FB1', 'stroke-width': '5', 'stroke-linecap': 'round', 'stroke-dasharray': '1 12', style: 'animation:icDash .55s linear infinite' });
  svg.append(shade, ring, trail);

  // ---- state ----
  let host: GuideHost | null = null;
  let raf = 0;
  let size = 112;
  let pos: Pt = { x: -200, y: 40 };
  let flight: { from: Pt; ctrl: Pt; to: Pt; t0: number; dur: number; spin: boolean } | null = null;
  let goal: Pt | null = null;
  let wander: Pt = { x: 0, y: 0 };
  let wanderGoal: Pt = { x: 0, y: 0 };
  let nextWander = 0;
  let face = 1;
  let explicit: Target = null;
  let target: Target = null;
  let lastFlash: string | null = null;
  let side: 'left' | 'right' = 'left';
  let hole: Box & { a: number } = { x: 0, y: 0, w: 0, h: 0, a: 0 };
  let lastSpark = 0;
  let nextRipple = 0;
  let trickIndex = 0;
  let celebratedLine = '';
  let lastPhase = '';
  let arcSign = 1;

  const resolve = (t: Target): Element | null => {
    if (!t) return null;
    if (typeof t !== 'string') return t.isConnected ? t : null;
    return document.querySelector(`[data-ui-id="${cssEscape(t)}"]`);
  };

  function setPose(name: string) {
    const src = img(name);
    if (!pose.src.endsWith(src)) pose.src = src;
  }

  function doTrick(kind?: (typeof TRICKS)[number]) {
    const k = kind ?? TRICKS[trickIndex++ % TRICKS.length];
    trick.className = '';
    void trick.offsetWidth; // restart the animation
    trick.className = `ic-g-${k}`;
  }

  function spark(x: number, y: number) {
    const s = svgEl('svg', { viewBox: '0 0 24 24', class: 'ic-g ic-g-spark' });
    s.append(svgEl('path', { d: SPARK, fill: ['#FFD36E', '#F48FB1', '#FFFFFF'][Math.floor(Math.random() * 3)] ?? '#FFD36E' }));
    s.style.left = `${x}px`;
    s.style.top = `${y}px`;
    document.body.append(s);
    window.setTimeout(() => s.remove(), 750);
  }

  function ripple(x: number, y: number) {
    const r = div('ic-g ic-g-ripple');
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    document.body.append(r);
    window.setTimeout(() => r.remove(), 1150);
  }

  function hearts() {
    for (let i = 0; i < 10; i++) {
      const h = svgEl('svg', { viewBox: '0 0 24 24', class: 'ic-g ic-g-heart' });
      h.append(svgEl('path', { d: HEART, fill: ['#F48FB1', PINK, '#FFC1D3'][i % 3] ?? PINK }));
      h.style.left = `${pos.x + size / 2 - 12 + (Math.random() - 0.5) * size * 0.7}px`;
      h.style.top = `${pos.y + size * 0.3}px`;
      h.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 140)}px`);
      h.style.animationDelay = `${i * 65}ms`;
      document.body.append(h);
      window.setTimeout(() => h.remove(), 1700 + i * 65);
    }
  }

  function flyTo(to: Pt, spin = false) {
    const from = { x: pos.x, y: pos.y };
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    if (d < 4) return;
    arcSign = -arcSign; // curve one way, then the other
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const nx = -(to.y - from.y) / (d || 1);
    const ny = (to.x - from.x) / (d || 1);
    const bend = Math.min(220, d * 0.45) * arcSign;
    const ctrl = { x: mid.x + nx * bend, y: Math.min(mid.y + ny * bend, Math.min(from.y, to.y) + 30) };
    flight = { from, ctrl, to, t0: performance.now(), dur: clamp(450 + d * 0.9, 600, 1300), spin: spin || d > 420 };
    goal = to;
  }

  /** Where the mascot stands to show `t`, on the current side of the phone (or inside it, on a phone). */
  function standFor(t: DOMRect, phone: DOMRect, outside: boolean): { at: Pt; tip: Pt; dir: number } {
    const cy = t.top + Math.min(t.height, 150) / 2;
    if (outside) {
      if (side === 'left') {
        const at = { x: phone.left - size - 30, y: clamp(cy - size / 2, 70, innerHeight - size - 16) };
        return { at, tip: { x: t.left + 4, y: clamp(cy, t.top + 10, t.bottom - 10) }, dir: 0 };
      }
      const at = { x: phone.right + 30, y: clamp(cy - size / 2, 70, innerHeight - size - 16) };
      return { at, tip: { x: t.right - 4, y: clamp(cy, t.top + 10, t.bottom - 10) }, dir: Math.PI };
    }
    // On a phone there is no room beside it: perch above the target, on the current side, and point down at it.
    const x = side === 'left' ? t.left + 6 : t.right - size - 6;
    const above = t.top - size - 18 > phone.top + 90;
    const at = {
      x: clamp(x, phone.left + 4, phone.right - size - 4),
      y: above ? t.top - size - 18 : clamp(t.bottom + 18, phone.top + 90, phone.bottom - size - 70),
    };
    const tipX = clamp(at.x + size / 2, t.left + 16, t.right - 16);
    return { at, tip: { x: tipX, y: above ? t.top + 4 : t.bottom - 4 }, dir: above ? Math.PI / 2 : -Math.PI / 2 };
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    if (!host) return;
    const phone = getPhone()?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
    size = phone.width < 360 || innerWidth < 600 ? 88 : 116;
    mascot.style.width = mascot.style.height = `${size}px`;
    const outside = phone.left >= size + 80 && innerWidth - phone.right >= size + 60;

    const v = host.state.voice ?? {};
    const phase = v.phase ?? '';
    const flash = host.state.flash ?? null;
    if (flash && flash !== lastFlash) {
      target = flash;
      explicit = null;
    }
    lastFlash = flash;
    const tEl = resolve(explicit ?? target);
    const t = tEl?.getBoundingClientRect();
    const tOk = t && t.width > 0 && t.bottom > phone.top + 40 && t.top < phone.bottom - 40 ? t : null;

    // ---- the question pill, at the top of the phone ----
    const q = phase === 'hearing' ? v.transcript ?? '' : v.you ?? '';
    askText.textContent = q;
    ask.style.opacity = q ? '1' : '0';
    const askW = Math.min(phone.width - 36, 360);
    ask.style.maxWidth = `${askW}px`;
    const askBox = { x: phone.left + (phone.width - Math.min(askW, ask.offsetWidth || askW)) / 2, y: phone.top + 54 };
    ask.style.left = `${askBox.x}px`;
    ask.style.top = `${askBox.y}px`;

    // ---- where to go ----
    const newQuestion = phase === 'hearing' && lastPhase !== 'hearing';
    if (newQuestion) side = side === 'left' ? 'right' : 'left'; // a new question: cross the phone
    let want: Pt;
    let point: { tip: Pt; dir: number } | null = null;
    if (phase === 'hearing' || (phase === 'thinking' && !tOk)) {
      // Fly up beside the question and listen.
      const w = ask.offsetWidth || 220;
      want = outside
        ? { x: side === 'left' ? phone.left - size - 30 : phone.right + 30, y: askBox.y - size / 3 }
        : { x: side === 'left' ? askBox.x - 6 : askBox.x + w - size + 6, y: askBox.y + 46 };
    } else if (tOk) {
      const s = standFor(tOk, phone, outside);
      want = s.at;
      if (phase === 'speaking' || phase === 'listening') point = { tip: s.tip, dir: s.dir };
    } else {
      want = outside
        ? { x: side === 'left' ? phone.left - size - 30 : phone.right + 30, y: phone.top + phone.height * 0.38 }
        : { x: side === 'left' ? phone.left + 12 : phone.right - size - 12, y: phone.top + phone.height * 0.45 };
    }
    if (!goal || Math.hypot(want.x - goal.x, want.y - goal.y) > 24) flyTo(want, newQuestion && outside);

    // ---- move ----
    let tilt = 0;
    let spinDeg = 0;
    if (flight) {
      const k = clamp((now - flight.t0) / flight.dur, 0, 1);
      const e = ease(k);
      const a = 1 - e;
      const p = {
        x: a * a * flight.from.x + 2 * a * e * flight.ctrl.x + e * e * flight.to.x,
        y: a * a * flight.from.y + 2 * a * e * flight.ctrl.y + e * e * flight.to.y,
      };
      const dx = p.x - pos.x;
      tilt = clamp(dx * 1.6, -24, 24);
      if (Math.abs(dx) > 0.5) face = dx > 0 ? 1 : -1;
      if (flight.spin) spinDeg = e * 360;
      pos = p;
      setPose('flying');
      if (now - lastSpark > 55) {
        lastSpark = now;
        spark(p.x + size / 2 - face * size * 0.35, p.y + size * 0.62);
      }
      if (k >= 1) {
        flight = null;
        doTrick();
      }
    } else {
      // Drift a little around the spot, so it never stands frozen.
      if (now > nextWander) {
        nextWander = now + 1400 + Math.random() * 1200;
        wanderGoal = { x: (Math.random() - 0.5) * 26, y: (Math.random() - 0.5) * 18 };
      }
      wander = { x: wander.x + (wanderGoal.x - wander.x) * 0.04, y: wander.y + (wanderGoal.y - wander.y) * 0.04 };
      if (point) face = Math.cos(point.dir) >= 0 ? 1 : -1;
      if (phase === 'hearing') setPose('curious');
      else if (phase === 'thinking') setPose('working');
      else setPose(MOOD[v.emotion ?? ''] ?? 'happy');
    }
    const shown = { x: pos.x + (flight ? 0 : wander.x), y: pos.y + (flight ? 0 : wander.y) };
    mascot.style.transform = `translate(${shown.x.toFixed(1)}px, ${shown.y.toFixed(1)}px) rotate(${(tilt + spinDeg).toFixed(1)}deg) scaleX(${face})`;

    // ---- point: spotlight, ring, arrow, trail, ripples ----
    const pointing = Boolean(point && tOk && !flight);
    const pad = 10;
    const goalHole = tOk ? { x: tOk.left - pad, y: tOk.top - pad, w: tOk.width + pad * 2, h: tOk.height + pad * 2 } : hole;
    const k = hole.w === 0 ? 1 : 0.18;
    hole = {
      x: hole.x + (goalHole.x - hole.x) * k,
      y: hole.y + (goalHole.y - hole.y) * k,
      w: hole.w + (goalHole.w - hole.w) * k,
      h: hole.h + (goalHole.h - hole.h) * k,
      a: hole.a + ((pointing && phase === 'speaking' ? 1 : 0) - hole.a) * 0.12,
    };
    if (hole.w > 0) {
      const inner = roundRect(hole, 20);
      shade.setAttribute('d', `M0,0H${innerWidth}V${innerHeight}H0Z ${inner}`);
      shade.style.opacity = String(hole.a);
      ring.setAttribute('d', inner);
      ring.style.opacity = String(Math.min(1, hole.a * 1.4));
    }
    if (pointing && point) {
      const { tip, dir } = point;
      const len = 60;
      pointer.style.opacity = '1';
      pointer.style.transform = `translate(${(tip.x - Math.cos(dir) * len - 32).toFixed(1)}px, ${(tip.y - Math.sin(dir) * len - 32).toFixed(1)}px) rotate(${dir}rad)`;
      const from = { x: shown.x + size / 2 + Math.cos(dir) * size * 0.4, y: shown.y + size * 0.55 + Math.sin(dir) * size * 0.3 };
      const tail = { x: tip.x - Math.cos(dir) * (len + 30), y: tip.y - Math.sin(dir) * (len + 30) };
      const cx = (from.x + tail.x) / 2;
      const cyc = Math.min(from.y, tail.y) - 40;
      trail.setAttribute('d', `M${from.x.toFixed(1)},${from.y.toFixed(1)} Q${cx.toFixed(1)},${cyc.toFixed(1)} ${tail.x.toFixed(1)},${tail.y.toFixed(1)}`);
      trail.style.opacity = '1';
      if (now > nextRipple && phase === 'speaking') {
        nextRipple = now + 1300;
        ripple(tip.x, tip.y);
      }
    } else {
      pointer.style.opacity = '0';
      trail.style.opacity = '0';
    }

    // ---- the bubble, in step with the voice, next to the mascot ----
    const line = v.line ?? '';
    const said = clamp(v.said ?? 0, 0, line.length);
    if (phase === 'thinking') {
      spoken.textContent = '';
      rest.textContent = '';
      dots.style.display = 'inline';
      bubble.style.opacity = '1';
    } else if ((phase === 'speaking' || phase === 'listening') && line) {
      dots.style.display = 'none';
      spoken.textContent = line.slice(0, said);
      rest.textContent = line.slice(said);
      bubble.style.opacity = '1';
      if (v.emotion === 'excited' && phase === 'speaking' && celebratedLine !== line) {
        celebratedLine = line;
        hearts();
        doTrick('spin');
      }
    } else {
      bubble.style.opacity = '0';
    }
    const bw = outside ? 290 : Math.min(phone.width - 28, 330);
    bubble.style.width = `${bw}px`;
    const bh = bubble.offsetHeight || 80;
    let bx: number;
    let by: number;
    if (outside) {
      bx = clamp(shown.x + size / 2 - bw / 2, 10, innerWidth - bw - 10);
      by = shown.y - bh - 12 < 56 ? shown.y + size + 10 : shown.y - bh - 12;
    } else {
      bx = phone.left + (phone.width - bw) / 2;
      by = shown.y < phone.top + phone.height * 0.5 ? phone.bottom - bh - 96 : phone.top + 104;
    }
    bubble.style.transform = `translate(${bx.toFixed(1)}px, ${by.toFixed(1)}px)`;

    lastPhase = phase;
  }

  return {
    start(h) {
      host = h;
      explicit = null;
      target = null;
      lastFlash = null;
      side = 'left';
      goal = null;
      hole = { x: 0, y: 0, w: 0, h: 0, a: 0 };
      // Fly in from off screen, top left, with a spin.
      pos = { x: -180, y: 30 };
      document.body.classList.add('ic-touring');
      document.body.append(svg, pointer, mascot, bubble, ask);
      setPose('flying');
      raf = requestAnimationFrame(frame);
    },
    stop() {
      cancelAnimationFrame(raf);
      host = null;
      flight = null;
      document.body.classList.remove('ic-touring');
      for (const e of [svg, pointer, mascot, bubble, ask]) e.remove();
    },
    pointAt(t) {
      explicit = t;
      if (t) side = side === 'left' ? 'right' : 'left';
    },
    celebrate() {
      hearts();
      doTrick('spin');
    },
    async goHome() {
      const phone = getPhone()?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
      const home = { x: phone.right - size * 0.9, y: phone.bottom - size - 60 };
      explicit = null;
      target = null;
      host = null; // stop following the app; this flight is ours
      cancelAnimationFrame(raf);
      bubble.style.opacity = '0';
      ask.style.opacity = '0';
      pointer.style.opacity = '0';
      trail.style.opacity = '0';
      shade.style.opacity = '0';
      ring.style.opacity = '0';
      const from = { ...pos };
      const ctrl = { x: (from.x + home.x) / 2, y: Math.min(from.y, home.y) - 260 };
      const t0 = performance.now();
      setPose('flying');
      await new Promise<void>((done) => {
        const step = (now: number) => {
          const k = clamp((now - t0) / 1300, 0, 1);
          const e = ease(k);
          const a = 1 - e;
          pos = { x: a * a * from.x + 2 * a * e * ctrl.x + e * e * home.x, y: a * a * from.y + 2 * a * e * ctrl.y + e * e * home.y };
          const scale = 1 - e * 0.6;
          mascot.style.transform = `translate(${pos.x}px, ${pos.y}px) rotate(${e * 720}deg) scale(${scale})`;
          mascot.style.opacity = String(k < 0.85 ? 1 : (1 - k) / 0.15);
          if (now - lastSpark > 45) {
            lastSpark = now;
            spark(pos.x + size / 2, pos.y + size / 2);
          }
          if (k < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
      for (let i = 0; i < 12; i++) spark(home.x + size / 2 + (Math.random() - 0.5) * 80, home.y + size / 2 + (Math.random() - 0.5) * 80);
      await new Promise((r) => window.setTimeout(r, 500));
      mascot.style.opacity = '';
    },
  };
}

/** CSS.escape where it exists (all current browsers), else a minimal escape for the ids the app uses. */
function cssEscape(s: string): string {
  const css = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS;
  return css?.escape ? css.escape(s) : s.replace(/["\\]/g, '\\$&');
}
