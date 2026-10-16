// The mascot that flies around the screen during the tour.
//
//   It listens: when a question comes in, it flies up beside it.
//   It shows: it flies (in a curve, leaving sparkles) to whatever it talks about, and points at it: the screen dims
//   around it, a glowing ring and a big arrow sit on it, ripples tap on it, and a dotted trail runs back to the mascot.
//   It talks in a bubble, in step with the voice; hearts when something good happens; a different little trick
//   (hop, spin, wiggle) each time it lands; it switches sides of the phone so it moves across the screen.
//   At the end it loops back into the Icarus button, where it lives.
//
// Everything eases: a flight follows its target if the screen moves under it (it never restarts in a new
// direction), the tilt, the turn, the arrow, the trail and the bubble all glide, and poses cross-fade.
//
// It mirrors the app's own state (the voice window's line and the element the app highlights), so the tour script
// doesn't change. The app's voice window and its own highlight box are hidden while the guide is out.

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
const TRICKS = ['hop', 'wiggle', 'spin', 'hop', 'bounce'] as const;

const CSS = `
@keyframes icBob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-7px) } }
@keyframes icHeart { 0% { transform: translate(0,0) scale(.5); opacity: 0 } 15% { opacity: 1 } 100% { transform: translate(var(--dx), -150px) scale(1.2); opacity: 0 } }
@keyframes icDash { to { stroke-dashoffset: -26 } }
@keyframes icDots { 0%,80%,100% { opacity: .25 } 40% { opacity: 1 } }
@keyframes icPoke { 0%,100% { transform: translateX(-14px) } 50% { transform: translateX(0) } }
@keyframes icRipple { from { transform: translate(-50%,-50%) scale(.3); opacity: .7 } to { transform: translate(-50%,-50%) scale(1.9); opacity: 0 } }
@keyframes icRing { 0%,100% { stroke-width: 4; opacity: 1 } 50% { stroke-width: 6.5; opacity: .6 } }
@keyframes icSpark { from { transform: translate(-50%,-50%) scale(1) rotate(0); opacity: .95 } to { transform: translate(-50%,-50%) scale(.2) rotate(120deg); opacity: 0 } }
@keyframes icHop { 0%,100% { transform: translateY(0) } 35% { transform: translateY(-30px) } 65% { transform: translateY(3px) } }
@keyframes icSpin { from { transform: rotate(0) } to { transform: rotate(360deg) } }
@keyframes icWiggle { 0%,100% { transform: rotate(0) } 20% { transform: rotate(-10deg) } 45% { transform: rotate(8deg) } 70% { transform: rotate(-5deg) } }
@keyframes icBounce { 0%,100% { transform: scale(1,1) } 30% { transform: scale(1.12,.88) } 60% { transform: scale(.94,1.07) } }
body.ic-touring [data-ui-id="icarus.voice_dock"] { opacity: 0 !important; pointer-events: none !important; }
body.ic-touring [data-screen-label="Phone"] div[style*="z-index: 36"][style*="pointer-events: none"] { opacity: 0 !important; }
.ic-g { position: fixed; left: 0; top: 0; pointer-events: none; }
.ic-g-mascot { z-index: 9450; will-change: transform; }
.ic-g-bob { animation: icBob 1.9s ease-in-out infinite; width: 100%; height: 100%; position: relative; }
.ic-g-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain;
  filter: drop-shadow(0 10px 16px rgba(150,60,85,.3)); }
.ic-g-hop { animation: icHop .65s cubic-bezier(.3,.7,.4,1); } .ic-g-spin { animation: icSpin .8s cubic-bezier(.45,0,.3,1); }
.ic-g-wiggle { animation: icWiggle .8s ease-in-out; } .ic-g-bounce { animation: icBounce .55s ease-out; }
.ic-g-bubble { z-index: 9460; box-sizing: border-box; background: #FFF7F9; border: 2.5px solid ${SOFT}; border-radius: 22px;
  padding: 10px 15px; color: ${INK}; font: 500 15.5px/1.4 ${FONT}; box-shadow: 0 12px 30px rgba(150,60,85,.25);
  transition: opacity .3s ease; will-change: transform; }
.ic-g-ask { z-index: 9460; box-sizing: border-box; display: flex; gap: 8px; align-items: center; background: #fff;
  border: 2.5px solid ${SOFT}; border-radius: 999px; padding: 7px 15px 7px 8px; color: ${INK}; font: 600 14.5px/1.3 ${FONT};
  box-shadow: 0 8px 20px rgba(150,60,85,.22); transition: opacity .3s ease; }
.ic-g-pointer { z-index: 9455; width: 64px; height: 64px; transition: opacity .3s ease; will-change: transform; }
.ic-g-poke { width: 100%; height: 100%; animation: icPoke .9s ease-in-out infinite; }
.ic-g-ripple { z-index: 9445; width: 70px; height: 70px; border-radius: 50%; border: 4px solid ${PINK}; animation: icRipple 1.2s ease-out forwards; }
.ic-g-heart { z-index: 9470; width: 24px; height: 24px; animation: icHeart 1.5s ease-out forwards; }
.ic-g-spark { z-index: 9440; width: 16px; height: 16px; animation: icSpark .8s ease-out forwards; }
.ic-g-dot { display: inline-block; width: 7px; height: 7px; margin: 0 2px; border-radius: 50%; background: ${PINK}; animation: icDots 1s infinite; }
`;

const HEART = 'M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 5.3 3.1 1.7-1.9 3.2-3.1 5.3-3.1 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z';
const SPARK = 'M12 1.5 14.2 9.8 22.5 12 14.2 14.2 12 22.5 9.8 14.2 1.5 12 9.8 9.8z';
const MIC = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>';
// An arrow pointing right (+x); the wrapper turns it toward the target.
const ARROW = `<svg viewBox="0 0 64 64" width="64" height="64"><path d="M6 24h28V11l26 21-26 21V40H6z" fill="${PINK}" stroke="#fff" stroke-width="4" stroke-linejoin="round" style="filter:drop-shadow(0 4px 6px rgba(150,60,85,.35))"/></svg>`;

// The arrow, in its own 64 px box: the tip is 28 px ahead of the middle, and the tail, poked back 14 px, 40 px behind.
const ARROW_TIP = 28;
const ARROW_REACH = 68;
// The mascot's body, as a share of its box, measured from the middle (the picture has some empty space around it).
const BODY = 0.42;
// Room the arrow needs between the mascot's body and the target.
const ARROW_ROOM = ARROW_REACH + 12;

const NS = 'http://www.w3.org/2000/svg';
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi < lo ? lo : hi, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
/** Move `cur` toward `to` by a fraction that doesn't depend on the frame rate (k is per 1/60 s). */
const approach = (cur: number, to: number, k: number, dt: number) => cur + (to - cur) * (1 - Math.pow(1 - k, dt / 16.7));
/** The same for angles, the short way round. */
const approachAngle = (cur: number, to: number, k: number, dt: number) => {
  const d = Math.atan2(Math.sin(to - cur), Math.cos(to - cur));
  return cur + d * (1 - Math.pow(1 - k, dt / 16.7));
};

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
  const rr = Math.max(0, Math.min(r, b.w / 2, b.h / 2));
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

interface Flight { from: Pt; to: Pt; bend: number; t0: number; dur: number; spin: boolean; long: boolean }

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
  // Two layers, so a new pose fades in over the old one.
  const layers = [document.createElement('img'), document.createElement('img')];
  for (const l of layers) {
    l.className = 'ic-g-img';
    l.alt = '';
    l.style.opacity = '0';
    bob.append(l);
  }
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
  const shade = svgEl('path', { fill: 'rgba(74,46,54,.32)', 'fill-rule': 'evenodd' });
  const ring = svgEl('path', { fill: 'none', stroke: PINK, 'stroke-width': '4', style: 'animation:icRing 1.2s ease-in-out infinite;filter:drop-shadow(0 0 8px rgba(233,122,154,.9))' });
  const trail = svgEl('path', { fill: 'none', stroke: '#F48FB1', 'stroke-width': '5', 'stroke-linecap': 'round', 'stroke-dasharray': '1 12', style: 'animation:icDash .6s linear infinite' });
  svg.append(shade, ring, trail);

  // ---- state ----
  let host: GuideHost | null = null;
  let raf = 0;
  let lastNow = 0;
  let size = 112;
  let pos: Pt = { x: -200, y: 40 };
  let prev: Pt = { ...pos };
  let goal: Pt | null = null;
  let flight: Flight | null = null;
  let wander: Pt = { x: 0, y: 0 };
  let wanderGoal: Pt = { x: 0, y: 0 };
  let nextWander = 0;
  let tilt = 0;
  let face = 1;
  let faceGoal = 1;
  let explicit: Target = null;
  let target: Target = null;
  let lastFlash: string | null = null;
  let side: 'left' | 'right' = 'left';
  let hole: Box & { a: number } = { x: 0, y: 0, w: 0, h: 0, a: 0 };
  let ptr = { x: 0, y: 0, angle: 0, scale: 1, shown: false };
  let trailA = 0;
  let trickUntil = 0;
  let bubbleHiddenAt = 0;
  let lastSpark = 0;
  let nextRipple = 0;
  let trickIndex = 0;
  let celebratedLine = '';
  let lastPhase = '';
  let bendSign = 1;
  let front = 0;
  let poseName = '';
  let poseAt = 0;
  let bubbleAt: Pt | null = null;
  let bubbleH = 80;
  let bubbleKey = '';
  let bubbleMeasured = 0;
  let askW = 220;
  let askKey = '';

  const resolve = (t: Target): Element | null => {
    if (!t) return null;
    if (typeof t !== 'string') return t.isConnected ? t : null;
    return document.querySelector(`[data-ui-id="${cssEscape(t)}"]`);
  };

  /** Change pose at once (the pictures are preloaded), not more often than every 260 ms. No cross-fade: halfway
   * through one, both pictures are half transparent and the mascot looks see-through. */
  function setPose(name: string, now: number, force = false) {
    if (name === poseName || (!force && now - poseAt < 260)) return;
    poseName = name;
    poseAt = now;
    const next = layers[1 - front]!;
    const cur = layers[front]!;
    next.src = img(name);
    next.style.opacity = '1';
    cur.style.opacity = '0';
    front = 1 - front;
  }

  function doTrick(kind?: (typeof TRICKS)[number]) {
    const now = performance.now();
    if (now < trickUntil) return; // never cut one off halfway: that reads as a jerk
    trickUntil = now + 850;
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
    window.setTimeout(() => s.remove(), 850);
  }

  function ripple(x: number, y: number) {
    const r = div('ic-g ic-g-ripple');
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    document.body.append(r);
    window.setTimeout(() => r.remove(), 1250);
  }

  function hearts() {
    for (let i = 0; i < 10; i++) {
      const h = svgEl('svg', { viewBox: '0 0 24 24', class: 'ic-g ic-g-heart' });
      h.append(svgEl('path', { d: HEART, fill: ['#F48FB1', PINK, '#FFC1D3'][i % 3] ?? PINK }));
      h.style.left = `${pos.x + size / 2 - 12 + (Math.random() - 0.5) * size * 0.7}px`;
      h.style.top = `${pos.y + size * 0.3}px`;
      h.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 140)}px`);
      h.style.animationDelay = `${i * 70}ms`;
      document.body.append(h);
      window.setTimeout(() => h.remove(), 1800 + i * 70);
    }
  }

  function flightPoint(f: Flight, e: number): Pt {
    const d = dist(f.from, f.to) || 1;
    const nx = -(f.to.y - f.from.y) / d;
    const ny = (f.to.x - f.from.x) / d;
    const mid = { x: (f.from.x + f.to.x) / 2, y: (f.from.y + f.to.y) / 2 };
    const ctrl = { x: mid.x + nx * f.bend, y: Math.min(mid.y + ny * f.bend, Math.min(f.from.y, f.to.y) + 30) };
    const a = 1 - e;
    return {
      x: a * a * f.from.x + 2 * a * e * ctrl.x + e * e * f.to.x,
      y: a * a * f.from.y + 2 * a * e * ctrl.y + e * e * f.to.y,
    };
  }

  function startFlight(to: Pt, now: number, spin: boolean) {
    const d = dist(pos, to);
    bendSign = -bendSign; // curve one way, then the other
    flight = {
      from: { ...pos }, to: { ...to }, bend: Math.min(200, d * 0.4) * bendSign, t0: now,
      dur: clamp(560 + d * 0.9, 750, 1400), spin, long: d > 200,
    };
    faceGoal = to.x >= pos.x ? 1 : -1;
  }

  /** Where the mascot stands to show `t`, on the current side of the phone (or inside it, on a phone). */
  function standFor(t: DOMRect, phone: DOMRect, outside: boolean): { at: Pt; tip: Pt } {
    const cy = t.top + Math.min(t.height, 150) / 2;
    const y = clamp(cy - size / 2, 70, innerHeight - size - 16);
    const tipY = clamp(cy, t.top + 10, t.bottom - 10);
    // The arrow sits between the mascot and the target, never on the mascot: stand at least an arrow away.
    if (outside) {
      if (side === 'left') {
        const tip = { x: t.left + 4, y: tipY };
        return { at: { x: Math.max(8, Math.min(phone.left - size - 30, tip.x - ARROW_ROOM - size * (0.5 + BODY))), y }, tip };
      }
      const tip = { x: t.right - 4, y: tipY };
      return { at: { x: Math.min(innerWidth - size - 8, Math.max(phone.right + 30, tip.x + ARROW_ROOM - size * (0.5 - BODY))), y }, tip };
    }
    // On a phone there is no room beside it: perch above (or below) the target, off to one side, toward the middle
    // of the phone, so the arrow runs diagonally from the mascot down to the target.
    const above = t.top - size - 24 > phone.top + 90;
    const tipX = clamp(side === 'left' ? t.left + Math.min(40, t.width / 2) : t.right - Math.min(40, t.width / 2), phone.left + 20, phone.right - 20);
    const toward = tipX < phone.left + phone.width / 2 ? 1 : -1;
    const at = {
      x: clamp(tipX + toward * size * 0.95 - size / 2, phone.left + 4, phone.right - size - 4),
      y: above ? t.top - size - 24 : clamp(t.bottom + 24, phone.top + 90, phone.bottom - size - 70),
    };
    return { at, tip: { x: tipX, y: above ? t.top + 4 : t.bottom - 4 } };
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    if (!host) return;
    const dt = clamp(now - (lastNow || now), 1, 50);
    lastNow = now;
    const phone = getPhone()?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
    const newSize = phone.width < 360 || innerWidth < 600 ? 88 : 116;
    if (newSize !== size) {
      size = newSize;
      mascot.style.width = mascot.style.height = `${size}px`;
    }
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
    if (q !== askKey) {
      askKey = q;
      askText.textContent = q;
      askW = q ? ask.offsetWidth || askW : askW;
    }
    ask.style.opacity = q ? '1' : '0';
    const maxAsk = Math.min(phone.width - 36, 360);
    ask.style.maxWidth = `${maxAsk}px`;
    const askBox = { x: phone.left + (phone.width - Math.min(maxAsk, askW)) / 2, y: phone.top + 54 };
    ask.style.transform = `translate(${askBox.x.toFixed(1)}px, ${askBox.y.toFixed(1)}px)`;

    // ---- where to be ----
    const newQuestion = phase === 'hearing' && lastPhase !== 'hearing';
    if (newQuestion) side = side === 'left' ? 'right' : 'left'; // a new question: cross the phone
    let want: Pt;
    let point: { tip: Pt } | null = null;
    if (phase === 'hearing' || (phase === 'thinking' && !tOk)) {
      want = outside
        ? { x: side === 'left' ? phone.left - size - 30 : phone.right + 30, y: askBox.y - size / 3 }
        : { x: side === 'left' ? askBox.x - 6 : askBox.x + askW - size + 6, y: askBox.y + 46 };
    } else if (tOk) {
      const s = standFor(tOk, phone, outside);
      want = s.at;
      if (phase === 'speaking' || phase === 'listening') point = { tip: s.tip };
    } else {
      want = outside
        ? { x: side === 'left' ? phone.left - size - 30 : phone.right + 30, y: phone.top + phone.height * 0.38 }
        : { x: side === 'left' ? phone.left + 12 : phone.right - size - 12, y: phone.top + phone.height * 0.45 };
    }
    goal = want;

    // ---- move: fly far, glide near; a flight follows its goal instead of starting over ----
    prev = { ...pos };
    if (flight) {
      flight.to = { x: approach(flight.to.x, goal.x, 0.2, dt), y: approach(flight.to.y, goal.y, 0.2, dt) };
      const k = clamp((now - flight.t0) / flight.dur, 0, 1);
      pos = flightPoint(flight, ease(k));
      if (flight.long && now - lastSpark > 70) {
        lastSpark = now;
        spark(pos.x + size / 2 - faceGoal * size * 0.35, pos.y + size * 0.62);
      }
      if (k >= 1) {
        const landed = flight;
        flight = null;
        if (landed.long) doTrick();
      }
    } else if (dist(pos, goal) > 150 || (newQuestion && dist(pos, goal) > 40)) {
      startFlight(goal, now, newQuestion && outside);
    } else {
      pos = { x: approach(pos.x, goal.x, 0.1, dt), y: approach(pos.y, goal.y, 0.1, dt) };
    }

    // ---- tilt into the motion, turn to face where it's going or pointing ----
    const vx = (pos.x - prev.x) / (dt / 16.7);
    tilt = approach(tilt, flight ? clamp(vx * 1.3, -18, 18) : 0, 0.15, dt);
    if (flight) faceGoal = flight.to.x >= flight.from.x ? 1 : -1;
    else if (point) faceGoal = point.tip.x >= pos.x + size / 2 ? 1 : -1;
    face = approach(face, faceGoal, 0.2, dt);
    const spinDeg = flight?.spin ? ease(clamp((now - flight.t0) / flight.dur, 0, 1)) * 360 : 0;

    // Drift a little when resting and not pointing, so it never stands frozen.
    if (!flight && !point) {
      if (now > nextWander) {
        nextWander = now + 1600 + Math.random() * 1400;
        wanderGoal = { x: (Math.random() - 0.5) * 20, y: (Math.random() - 0.5) * 14 };
      }
    } else {
      wanderGoal = { x: 0, y: 0 };
    }
    wander = { x: approach(wander.x, wanderGoal.x, 0.03, dt), y: approach(wander.y, wanderGoal.y, 0.03, dt) };

    // ---- pose ----
    if (flight) setPose('flying', now);
    else if (phase === 'hearing') setPose('curious', now);
    else if (phase === 'thinking') setPose('working', now);
    else setPose(MOOD[v.emotion ?? ''] ?? 'happy', now);

    const shown = { x: pos.x + wander.x, y: pos.y + wander.y };
    const flipX = Math.sign(face || 1) * Math.max(0.12, Math.abs(face));
    mascot.style.transform = `translate(${shown.x.toFixed(1)}px, ${shown.y.toFixed(1)}px) rotate(${(tilt + spinDeg).toFixed(1)}deg) scaleX(${flipX.toFixed(3)})`;

    // ---- point: spotlight, ring, arrow, trail, ripples ----
    const pointing = Boolean(point && tOk && !flight);
    const pad = 10;
    if (tOk) {
      const goalHole = { x: tOk.left - pad, y: tOk.top - pad, w: tOk.width + pad * 2, h: tOk.height + pad * 2 };
      const first = hole.w === 0;
      hole = {
        x: first ? goalHole.x : approach(hole.x, goalHole.x, 0.16, dt),
        y: first ? goalHole.y : approach(hole.y, goalHole.y, 0.16, dt),
        w: first ? goalHole.w : approach(hole.w, goalHole.w, 0.16, dt),
        h: first ? goalHole.h : approach(hole.h, goalHole.h, 0.16, dt),
        a: hole.a,
      };
    }
    hole.a = approach(hole.a, pointing && phase === 'speaking' ? 1 : 0, 0.08, dt);
    if (hole.w > 0) {
      const inner = roundRect(hole, 20);
      shade.setAttribute('d', `M0,0H${innerWidth}V${innerHeight}H0Z ${inner}`);
      shade.setAttribute('opacity', hole.a.toFixed(3));
      ring.setAttribute('d', inner);
      ring.setAttribute('opacity', Math.min(1, hole.a * 1.4).toFixed(3));
    }
    let gap = 0;
    if (point && tOk) {
      // Aim from the mascot's middle at the target; the arrow's tip touches the target and its tail (even when it
      // pokes back) stays clear of the mascot's body. Less room: a smaller arrow, never an overlap.
      const c = { x: shown.x + size / 2, y: shown.y + size / 2 };
      const d = Math.max(1, dist(c, point.tip));
      const u = { x: (point.tip.x - c.x) / d, y: (point.tip.y - c.y) / d };
      const body = size * BODY;
      const scale = clamp((d - body - 8) / ARROW_REACH, 0.45, 1);
      const want = { x: point.tip.x - u.x * ARROW_TIP * scale, y: point.tip.y - u.y * ARROW_TIP * scale };
      const angle = Math.atan2(u.y, u.x);
      if (!ptr.shown) ptr = { x: want.x, y: want.y, angle, scale, shown: true };
      ptr.x = approach(ptr.x, want.x, 0.2, dt);
      ptr.y = approach(ptr.y, want.y, 0.2, dt);
      ptr.angle = approachAngle(ptr.angle, angle, 0.2, dt);
      ptr.scale = approach(ptr.scale, scale, 0.2, dt);
      gap = d - body - ARROW_REACH * ptr.scale;
      if (pointing) {
        // The dotted trail fills the space between the mascot and the arrow's tail, when there is any.
        const from = { x: c.x + u.x * body, y: c.y + u.y * body };
        const back = (ARROW_REACH - ARROW_TIP) * ptr.scale;
        const tail = { x: ptr.x - Math.cos(ptr.angle) * back, y: ptr.y - Math.sin(ptr.angle) * back };
        const bulge = Math.min(30, Math.max(0, gap) * 0.25);
        const mid = { x: (from.x + tail.x) / 2 - u.y * bulge, y: (from.y + tail.y) / 2 + u.x * bulge };
        trail.setAttribute('d', `M${from.x.toFixed(1)},${from.y.toFixed(1)} Q${mid.x.toFixed(1)},${mid.y.toFixed(1)} ${tail.x.toFixed(1)},${tail.y.toFixed(1)}`);
        if (now > nextRipple && phase === 'speaking') {
          nextRipple = now + 1500;
          ripple(point.tip.x, point.tip.y);
        }
      }
    }
    // Fade in, but vanish at once: a fading arrow left over the mascot as it flies off looks broken.
    const showArrow = pointing && gap > -4;
    pointer.style.transition = showArrow ? 'opacity .3s ease' : 'none';
    pointer.style.opacity = showArrow ? '1' : '0';
    if (ptr.shown) {
      pointer.style.transform = `translate(${(ptr.x - 32).toFixed(1)}px, ${(ptr.y - 32).toFixed(1)}px) rotate(${ptr.angle.toFixed(3)}rad) scale(${ptr.scale.toFixed(3)})`;
    }
    trailA = pointing && gap > 14 ? approach(trailA, 1, 0.12, dt) : 0;
    trail.setAttribute('opacity', trailA.toFixed(3));
    if (!point) ptr.shown = false;

    // ---- the bubble, in step with the voice, next to the mascot ----
    const line = v.line ?? '';
    const said = clamp(v.said ?? 0, 0, line.length);
    let visible = false;
    if (phase === 'thinking') {
      spoken.textContent = '';
      rest.textContent = '';
      dots.style.display = 'inline';
      visible = true;
    } else if ((phase === 'speaking' || phase === 'listening') && line) {
      dots.style.display = 'none';
      spoken.textContent = line.slice(0, said);
      rest.textContent = line.slice(said);
      visible = true;
      if (v.emotion === 'excited' && phase === 'speaking' && celebratedLine !== line) {
        celebratedLine = line;
        hearts();
        doTrick('spin');
      }
    }
    bubble.style.opacity = visible ? '1' : '0';
    const bw = outside ? 290 : Math.min(phone.width - 28, 330);
    bubble.style.width = `${bw}px`;
    const key = `${phase}|${line}|${bw}`;
    if (key !== bubbleKey && now - bubbleMeasured > 120) {
      bubbleKey = key;
      bubbleMeasured = now;
      bubbleH = bubble.offsetHeight || bubbleH;
    }
    let bx: number;
    let by: number;
    if (outside) {
      bx = clamp(shown.x + size / 2 - bw / 2, 10, innerWidth - bw - 10);
      by = shown.y - bubbleH - 12 < 56 ? shown.y + size + 10 : shown.y - bubbleH - 12;
    } else {
      bx = phone.left + (phone.width - bw) / 2;
      by = shown.y < phone.top + phone.height * 0.5 ? phone.bottom - bubbleH - 96 : phone.top + 104;
    }
    if (visible) bubbleHiddenAt = 0;
    else if (!bubbleHiddenAt) bubbleHiddenAt = now;
    if (!bubbleAt || (!visible && now - bubbleHiddenAt > 400)) bubbleAt = { x: bx, y: by };
    bubbleAt = { x: approach(bubbleAt.x, bx, 0.2, dt), y: approach(bubbleAt.y, by, 0.2, dt) };
    bubble.style.transform = `translate(${bubbleAt.x.toFixed(1)}px, ${bubbleAt.y.toFixed(1)}px)`;

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
      flight = null;
      hole = { x: 0, y: 0, w: 0, h: 0, a: 0 };
      ptr = { x: 0, y: 0, angle: 0, scale: 1, shown: false };
      trailA = 0;
      bubbleAt = null;
      lastNow = 0;
      poseName = '';
      // Fly in from off screen, top left.
      pos = { x: -180, y: 30 };
      mascot.style.width = mascot.style.height = `${size}px`;
      document.body.classList.add('ic-touring');
      document.body.append(svg, pointer, mascot, bubble, ask);
      setPose('flying', performance.now(), true);
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
      pointer.style.transition = 'none';
      pointer.style.opacity = '0';
      trail.setAttribute('opacity', '0');
      shade.setAttribute('opacity', '0');
      ring.setAttribute('opacity', '0');
      const from = { ...pos };
      const ctrl = { x: (from.x + home.x) / 2, y: Math.min(from.y, home.y) - 240 };
      const t0 = performance.now();
      setPose('flying', t0, true);
      await new Promise<void>((done) => {
        const step = (now: number) => {
          const k = clamp((now - t0) / 1400, 0, 1);
          const e = ease(k);
          const a = 1 - e;
          pos = { x: a * a * from.x + 2 * a * e * ctrl.x + e * e * home.x, y: a * a * from.y + 2 * a * e * ctrl.y + e * e * home.y };
          const scale = 1 - e * 0.6;
          mascot.style.transform = `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px) rotate(${(e * 720).toFixed(1)}deg) scale(${scale.toFixed(3)})`;
          mascot.style.opacity = String(k < 0.85 ? 1 : (1 - k) / 0.15);
          if (now - lastSpark > 50) {
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
