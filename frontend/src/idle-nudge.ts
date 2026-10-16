// Icarus speaks up when the user is stuck: after about 15 seconds on a screen with no activity, it asks the backend
// (POST /nudge, rules only, no model) whether there is something useful to say, and shows it quietly:
//   - a speech bubble on the mascot button
//   - the same line in the chat history, with a tap-to-send chip when useful
//   - a highlight on the part of the screen it talks about
// It is SILENT on purpose: it never calls speak() or say(), so it can't talk over anyone or break voice mode.
// The design file is not touched: this module only reads the prototype instance and calls its own methods.
//
// It stays out of the way. It only fires when the chat and voice are closed, no guide or explainer is open, no scenario
// stopwatch is running and no bubble is showing. Any tap, key, scroll or state change restarts the countdown.
// Each (screen state) is asked once, each (screen, reason) is shown once, and a session shows at most MAX_PER_SESSION.

export interface NudgeReply {
  reason: string;
  text: string;
  highlight: string | null;
  suggestions: string[];
}

export interface IdleNudgeOptions {
  /** Ask the backend. Resolve null for "nothing to say"; a rejection is treated the same. */
  fetchNudge: (context: Record<string, unknown>, idleSeconds: number) => Promise<NudgeReply | null>;
  getPhone: () => Element | null;
  idleMs?: number;
  /** How often to look. Small values are for tests. */
  checkMs?: number;
  maxPerSession?: number;
}

export const IDLE_MS = 15_000;
export const MAX_PER_SESSION = 4;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'input', 'scroll', 'touchstart', 'wheel'];

type Proto = Record<string, any>; // the design runtime exports a dynamic logic class

/** Starts watching. Returns a function that stops it. */
export function installIdleNudge(proto: Proto, o: IdleNudgeOptions): () => void {
  proto.__idleNudgeStop?.(); // installing twice replaces the first: never two timers, two listeners, two nudges
  const idleMs = o.idleMs ?? IDLE_MS;
  const checkMs = o.checkMs ?? 1000;
  const max = o.maxPerSession ?? MAX_PER_SESSION;
  let lastActivity = Date.now();
  let lastSignature = '';
  let askedSignature = '';
  let busy = false;
  let stopped = false;
  let shownCount = 0;
  const shown = new Set<string>();

  const signature = () => {
    const s = proto.state ?? {};
    return [proto.screenKey?.(s), s.buyAmount, s.walletId, s.frozen, s.period, s.pfPeriod, s.filter, s.asst, s.lang].join('|');
  };

  /** Quiet enough to speak up? Never while the user is talking to Icarus, being guided, or in a scripted run. */
  const quiet = () => {
    const s = proto.state ?? {};
    return (s.asst === 'closed' || s.asst === 'min') && !s.closing && !s.typing && !s.guide && !s.explain && !s.voice && !s.timer && !s.fabBubble;
  };

  const onActivity = (e: Event) => {
    const phone = o.getPhone();
    if (phone && e.target instanceof Node && phone.contains(e.target)) lastActivity = Date.now();
  };
  for (const name of ACTIVITY_EVENTS) document.addEventListener(name, onActivity, true);

  const check = async () => {
    if (stopped || busy) return;
    const now = Date.now();
    const sig = signature();
    if (sig !== lastSignature) {
      lastSignature = sig;
      lastActivity = now;
      return;
    }
    if (shownCount >= max || sig === askedSignature || now - lastActivity < idleMs || !quiet()) return;

    busy = true;
    askedSignature = sig;
    let nudge: NudgeReply | null = null;
    try {
      nudge = await o.fetchNudge(proto.getContext(), Math.round((now - lastActivity) / 1000));
    } catch {
      nudge = null; // the backend being slow or down is never shown to the user
    }
    busy = false;

    // The user may have acted while we waited for the answer.
    if (stopped || typeof nudge?.text !== 'string' || !nudge.text || signature() !== sig || !quiet()) return;
    // Whatever the backend sent, only well-formed pieces reach the screen.
    const suggestions = Array.isArray(nudge.suggestions) ? nudge.suggestions.filter((s) => typeof s === 'string' && s).slice(0, 3) : [];
    const highlight = typeof nudge.highlight === 'string' && nudge.highlight ? nudge.highlight : null;
    const key = `${proto.screenKey(proto.state)}|${nudge.reason}`;
    if (shown.has(key)) return;
    shown.add(key);
    shownCount += 1;

    proto.bubble(nudge.text);
    proto.pushIcarus({ text: nudge.text, speech: nudge.text, suggestions, sources: ['nudge · rules'] });
    if (highlight) proto.flash(highlight);
    proto.log('nudge_shown', { reason: nudge.reason, idle_s: Math.round((Date.now() - lastActivity) / 1000) });
  };

  const timer = setInterval(() => void check(), checkMs);
  const stop = () => {
    stopped = true;
    if (proto.__idleNudgeStop === stop) proto.__idleNudgeStop = undefined;
    clearInterval(timer);
    for (const name of ACTIVITY_EVENTS) document.removeEventListener(name, onActivity, true);
  };
  proto.__idleNudgeStop = stop;
  return stop;
}

/** The usual way to ask: the backend's POST /nudge. */
export function backendNudge(url: string, userId: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): IdleNudgeOptions['fetchNudge'] {
  return async (context, idleSeconds) => {
    const res = await fetchImpl(`${url}/nudge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: userId, lang: context.language === 'th' ? 'th' : 'en', snapshot: context, idle_s: idleSeconds }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { nudge?: NudgeReply | null };
    return body.nudge ?? null;
  };
}
