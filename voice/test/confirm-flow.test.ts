import { beforeEach, describe, expect, it } from 'vitest';
import { ConfirmFlow, type ConfirmConfig, type ConfirmHooks, type TimerPort } from '../src/client/confirm-flow';
import type { ConfirmIntentEvent, CountdownEvent, FinalTranscript, TradePreview } from '../src/shared/types';

const preview: TradePreview = { preview_id: 'p1', side: 'buy', asset: 'gold', amount: 1000, fee: 15, total: 1015, currency: 'THB' };

/** A clock and timers that only move when the test says so. */
class FakeTimers implements TimerPort {
  t = 0;
  private next = 1;
  private pending = new Map<number, { at: number; fn: () => void }>();
  now() { return this.t; }
  setTimeout(fn: () => void, ms: number) { const id = this.next++; this.pending.set(id, { at: this.t + ms, fn }); return id; }
  clearTimeout(h: unknown) { this.pending.delete(h as number); }
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const due = [...this.pending.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.pending.delete(due[0]);
      this.t = due[1].at;
      due[1].fn();
    }
    this.t = end;
  }
  get pendingCount() { return this.pending.size; }
}

function setup(over: Partial<ConfirmConfig> = {}) {
  const timers = new FakeTimers();
  const log = { phases: [] as Array<string | null>, countdown: [] as CountdownEvent[], intents: [] as ConfirmIntentEvent[], cancelled: [] as Array<{ by: string; wasCounting: boolean }>, expired: 0 };
  const hooks: ConfirmHooks = {
    onPhase: (p) => log.phases.push(p),
    onCountdown: (e) => log.countdown.push(e),
    onIntent: (e) => log.intents.push(e),
    onCancelled: (i) => log.cancelled.push({ by: i.by, wasCounting: i.wasCounting }),
    onExpired: () => { log.expired++; },
  };
  const flow = new ConfirmFlow(
    { minConfidence: 0.85, countdownMs: 3000, awaitTimeoutMs: 30_000, requiresTap: true, acceptedSources: ['voice'], ...over },
    timers,
    hooks,
  );
  /** Say something. By default the speech starts right now (after the read-back ended). */
  const say = (text: string, o: Partial<Pick<FinalTranscript, 'confidence' | 'source' | 'speechStartedAt'>> = {}) =>
    flow.handleUtterance({ text, confidence: 0.95, source: 'voice', speechStartedAt: timers.t, ...o });
  return { flow, timers, log, say };
}

/** begin -> read-back plays -> read-back finishes */
function readIt(s: ReturnType<typeof setup>) {
  s.flow.begin(preview);
  s.flow.readbackStarted();
  s.timers.advance(4000); // the read-back takes a few seconds
  s.flow.readbackFinished();
  s.timers.advance(300); // user thinks, then speaks
}

describe('RULE: confirm cannot fire before the read-back ends', () => {
  it('ignores "confirm" while the read-back is playing', () => {
    const s = setup();
    s.flow.begin(preview);
    s.flow.readbackStarted();
    s.timers.advance(1000);
    expect(s.say('confirm')).toBe('too_early');
    s.timers.advance(10_000);
    expect(s.log.countdown).toHaveLength(0);
    expect(s.log.intents).toHaveLength(0);
    expect(s.flow.phase).toBe('readback');
  });

  it('ignores "confirm" before the read-back has even started', () => {
    const s = setup();
    s.flow.begin(preview);
    expect(s.say('confirm')).toBe('too_early');
    expect(s.log.intents).toHaveLength(0);
  });

  it('a read-back that was interrupted never unlocks confirm', () => {
    const s = setup();
    s.flow.begin(preview);
    s.flow.readbackStarted();
    s.timers.advance(1500);
    // the user barges in: the controller stops the audio and does NOT call readbackFinished()
    expect(s.say('confirm')).toBe('too_early');
    s.timers.advance(60_000);
    expect(s.flow.phase).toBe('readback');
    expect(s.log.intents).toHaveLength(0);
  });

  it('works after the user asks for the read-back again and it finishes', () => {
    const s = setup();
    s.flow.begin(preview);
    s.flow.readbackStarted();
    s.timers.advance(1000);
    expect(s.say('repeat that')).toBe('repeat');
    s.flow.readbackStarted();
    s.timers.advance(4000);
    s.flow.readbackFinished();
    s.timers.advance(200);
    expect(s.say('confirm')).toBe('confirmed');
  });

  it('rejects words that were SPOKEN during the read-back but transcribed after it ended', () => {
    const s = setup();
    s.flow.begin(preview);
    s.flow.readbackStarted();
    s.timers.advance(3900); // user starts saying "confirm" here
    const spokeAt = s.timers.t;
    s.timers.advance(100);
    s.flow.readbackFinished(); // read-back ends at 4000
    s.timers.advance(400); // the transcript lands
    expect(s.say('confirm', { speechStartedAt: spokeAt })).toBe('unclear');
    expect(s.log.countdown).toHaveLength(0);
  });
});

describe('RULE: confirm needs high confidence, voice, and an exact phrase', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => { s = setup(); readIt(s); });

  it('accepts a clear "confirm"', () => {
    expect(s.say('confirm')).toBe('confirmed');
  });

  it('rejects low confidence', () => {
    expect(s.say('confirm', { confidence: 0.6 })).toBe('unclear');
    expect(s.say('confirm', { confidence: 0.849 })).toBe('unclear');
    expect(s.log.countdown).toHaveLength(0);
  });

  it('rejects UNKNOWN confidence (fails closed)', () => {
    expect(s.say('confirm', { confidence: null })).toBe('unclear');
    expect(s.log.countdown).toHaveLength(0);
  });

  it('rejects unknown speech timing (fails closed)', () => {
    expect(s.say('confirm', { speechStartedAt: null })).toBe('unclear');
  });

  it('never accepts typed text as a confirm', () => {
    expect(s.say('confirm', { source: 'text' })).toBe('passthrough');
    expect(s.log.countdown).toHaveLength(0);
    expect(s.flow.phase).toBeNull();
  });

  it('does not accept simulated input unless allowed', () => {
    expect(s.say('confirm', { source: 'simulated' })).toBe('passthrough');
    const allowed = setup({ acceptedSources: ['voice', 'simulated'] });
    readIt(allowed);
    expect(allowed.say('confirm', { source: 'simulated' })).toBe('confirmed');
  });

  it.each(['yes', 'ok', 'okay', 'sure', 'do it', "don't confirm", 'confirm the fee is wrong'])('never confirms on "%s"', (text) => {
    expect(s.say(text)).not.toBe('confirmed');
    expect(s.log.countdown).toHaveLength(0);
  });

  it('accepts Thai confirm', () => {
    const t = setup();
    readIt(t);
    expect(t.say('ยืนยันครับ')).toBe('confirmed');
  });
});

describe('countdown and intent', () => {
  it('counts 3, 2, 1, then sends ONE intent that asks for a tap', () => {
    const s = setup();
    readIt(s);
    s.say('confirm');
    expect(s.log.countdown.map((c) => [c.phase, c.secondsLeft])).toEqual([['start', 3]]);
    expect(s.flow.phase).toBe('countdown');

    s.timers.advance(1000);
    s.timers.advance(1000);
    expect(s.log.countdown.map((c) => [c.phase, c.secondsLeft])).toEqual([['start', 3], ['tick', 2], ['tick', 1]]);
    expect(s.log.intents).toHaveLength(0); // not yet

    s.timers.advance(1000);
    expect(s.log.countdown.at(-1)).toMatchObject({ phase: 'done', secondsLeft: 0, remainingMs: 0, previewId: 'p1' });
    expect(s.log.intents).toEqual([{ previewId: 'p1', source: 'voice', requiresTap: true }]);
    expect(s.flow.phase).toBeNull();

    s.timers.advance(60_000);
    expect(s.log.intents).toHaveLength(1);
  });

  it('only reports an intent. There is nothing else it could execute', () => {
    const s = setup();
    readIt(s);
    s.say('confirm');
    s.timers.advance(3000);
    expect(Object.keys(s.log.intents[0]!).sort()).toEqual(['previewId', 'requiresTap', 'source']);
  });

  it('cannot be restarted while counting', () => {
    const s = setup();
    readIt(s);
    s.say('confirm');
    expect(s.say('confirm')).toBe('ignored');
    s.timers.advance(3000);
    expect(s.log.intents).toHaveLength(1);
  });

  it('after the intent, more speech is a normal conversation', () => {
    const s = setup();
    readIt(s);
    s.say('confirm');
    s.timers.advance(3000);
    expect(s.say('confirm')).toBe('passthrough');
    expect(s.log.intents).toHaveLength(1);
  });

  it('honours a custom countdown and requiresTap setting', () => {
    const s = setup({ countdownMs: 2000, requiresTap: false });
    readIt(s);
    s.say('confirm');
    s.timers.advance(2000);
    expect(s.log.countdown.map((c) => c.secondsLeft)).toEqual([2, 1, 0]);
    expect(s.log.intents[0]?.requiresTap).toBe(false);
  });
});

describe('cancel always works', () => {
  it('cancels by voice before the countdown', () => {
    const s = setup();
    readIt(s);
    expect(s.say('cancel')).toBe('cancelled');
    expect(s.log.cancelled).toEqual([{ by: 'voice', wasCounting: false }]);
    expect(s.log.countdown.at(-1)).toMatchObject({ phase: 'cancelled', cancelledBy: 'voice', wasCounting: false });
    expect(s.flow.phase).toBeNull();
  });

  it('cancels by voice during the read-back, even at low confidence', () => {
    const s = setup();
    s.flow.begin(preview);
    s.flow.readbackStarted();
    expect(s.say('cancel', { confidence: 0.3 })).toBe('cancelled');
  });

  it('cancels by voice during the countdown and no intent is ever sent', () => {
    const s = setup();
    readIt(s);
    s.say('confirm');
    s.timers.advance(1500);
    expect(s.say('cancel')).toBe('cancelled');
    expect(s.log.countdown.at(-1)).toMatchObject({ phase: 'cancelled', wasCounting: true, remainingMs: 1500 });
    s.timers.advance(60_000);
    expect(s.log.intents).toHaveLength(0);
    expect(s.timers.pendingCount).toBe(0);
  });

  it('"stop" and "wait" cancel the countdown too', () => {
    for (const word of ['stop', 'wait', 'หยุด']) {
      const s = setup();
      readIt(s);
      s.say('confirm');
      expect(s.say(word)).toBe('cancelled');
      s.timers.advance(10_000);
      expect(s.log.intents).toHaveLength(0);
    }
  });

  it('cancels by tap during the countdown', () => {
    const s = setup();
    readIt(s);
    s.say('confirm');
    s.timers.advance(2000);
    expect(s.flow.cancel('tap')).toBe(true);
    expect(s.log.cancelled).toEqual([{ by: 'tap', wasCounting: true }]);
    s.timers.advance(10_000);
    expect(s.log.intents).toHaveLength(0);
  });

  it('cancel does nothing when there is no preview', () => {
    const s = setup();
    expect(s.flow.cancel('tap')).toBe(false);
  });

  it('Thai cancel works', () => {
    const s = setup();
    readIt(s);
    expect(s.say('ยกเลิก')).toBe('cancelled');
  });
});

describe('waiting, repeating and moving on', () => {
  it('"wait" keeps the preview and restarts the waiting time', () => {
    const s = setup();
    readIt(s);
    s.timers.advance(25_000);
    expect(s.say('wait')).toBe('ignored');
    s.timers.advance(25_000); // would have expired without the restart
    expect(s.flow.phase).toBe('awaiting');
    s.timers.advance(6000);
    expect(s.log.expired).toBe(1);
  });

  it('drops the voice flow if nobody answers', () => {
    const s = setup();
    readIt(s);
    s.timers.advance(30_000);
    expect(s.log.expired).toBe(1);
    expect(s.flow.phase).toBeNull();
    expect(s.say('confirm')).toBe('passthrough');
  });

  it('treats other speech as a new question and ends the voice flow', () => {
    const s = setup();
    readIt(s);
    expect(s.say("what's the fee again")).toBe('passthrough');
    expect(s.flow.phase).toBeNull();
    expect(s.say('confirm')).toBe('passthrough'); // nothing pending any more
    expect(s.log.intents).toHaveLength(0);
  });

  it('can be told the UI handled it', () => {
    const s = setup();
    readIt(s);
    s.flow.resolved();
    expect(s.flow.phase).toBeNull();
    expect(s.timers.pendingCount).toBe(0);
  });

  it('a new preview replaces the old one cleanly', () => {
    const s = setup();
    readIt(s);
    s.flow.begin({ ...preview, preview_id: 'p2' });
    expect(s.flow.phase).toBe('readback');
    expect(s.flow.previewId).toBe('p2');
    expect(s.say('confirm')).toBe('too_early');
  });
});

describe('fuzz: no sequence of events can produce an intent without a finished read-back', () => {
  // Small deterministic random generator so failures can be replayed.
  const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  it('holds over 3000 random runs', () => {
    for (let seed = 1; seed <= 3000; seed++) {
      const rand = rng(seed);
      const s = setup();
      let readbackFinishedSinceBegin = false;
      let finishedAt = -1;
      let begun = false;
      let intentsBefore = 0;

      for (let step = 0; step < 25; step++) {
        const roll = Math.floor(rand() * 11);
        const phaseBefore = s.flow.phase;
        const countdownsBefore = s.log.countdown.filter((c) => c.phase === 'start').length;

        if (roll === 0) { s.flow.begin(preview); begun = true; readbackFinishedSinceBegin = false; finishedAt = -1; }
        else if (roll === 1) { s.flow.readbackStarted(); if (phaseBefore !== 'countdown' && begun && phaseBefore !== null) { readbackFinishedSinceBegin = false; finishedAt = -1; } }
        else if (roll === 2) { s.flow.readbackFinished(); if (phaseBefore === 'readback') { readbackFinishedSinceBegin = true; finishedAt = s.timers.t; } }
        else if (roll === 3) s.say('confirm', { confidence: rand() < 0.5 ? 0.95 : rand(), speechStartedAt: rand() < 0.2 ? null : s.timers.t - Math.floor(rand() * 800), source: rand() < 0.8 ? 'voice' : 'text' });
        else if (roll === 4) s.say('cancel');
        else if (roll === 5) s.say('what is the fee');
        else if (roll === 6) s.say('repeat that');
        else if (roll === 7) s.flow.cancel('tap');
        else if (roll === 8) s.say('wait');
        else if (roll === 9) s.flow.resolved();
        else s.timers.advance(Math.floor(rand() * 4000));

        const countdownsAfter = s.log.countdown.filter((c) => c.phase === 'start').length;
        if (countdownsAfter > countdownsBefore) {
          // A countdown just started. The read-back must have finished first, and the speech must have come after it.
          expect(readbackFinishedSinceBegin, `seed ${seed} step ${step}`).toBe(true);
          expect(phaseBefore, `seed ${seed} step ${step}`).toBe('awaiting');
          expect(finishedAt, `seed ${seed} step ${step}`).toBeGreaterThanOrEqual(0);
        }
        // Intents only follow countdowns, one for one at most.
        expect(s.log.intents.length).toBeLessThanOrEqual(s.log.countdown.filter((c) => c.phase === 'start').length);
        intentsBefore = s.log.intents.length;
      }
      expect(intentsBefore).toBeLessThanOrEqual(1 + 25);
      s.flow.dispose();
    }
  });
});
