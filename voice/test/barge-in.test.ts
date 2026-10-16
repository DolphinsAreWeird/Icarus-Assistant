// The barge-in rule on its own (client/barge-in.ts and client/noise-floor.ts), with synthetic mic levels and
// transcripts. Icarus must stop only for real, sustained speech from the user: loud above the room, for long
// enough, with real words that are not Icarus's own voice. The controller wiring is tested in controller.test.ts.
import { describe, expect, it } from 'vitest';
import { BargeInDetector, wordEvidence } from '../src/client/barge-in';
import { NoiseFloor } from '../src/client/noise-floor';
import { DEFAULTS } from '../src/config/defaults';

const cfg = DEFAULTS.bargeIn;
const FRAME_MS = 20;

/** A quiet room, after the browser's noise suppression. */
const ROOM = 0.002;
type Level = number | ((frame: number) => number);

/** A voice: syllables (about four a second) whose loudness rises and falls below `peak`. */
const voice = (peak: number) => (i: number) => peak * (0.35 + 0.65 * Math.sin((Math.PI * i) / 11) ** 2);

/** Other people talking: an uneven murmur below `peak`. Deterministic, so the tests never flake. */
function chatter(peak: number, seed = 7) {
  let x = seed;
  const rand = () => (x = (x * 16807) % 2147483647) / 2147483647;
  return (i: number) => peak * (0.45 + 0.55 * rand()) * (0.55 + 0.45 * Math.sin((Math.PI * i) / 9) ** 2);
}

/** A sound that starts at `peak` and dies away by `decay` each frame (a door slam, a cough's tail). */
const bang = (peak: number, decay: number) => (i: number) => Math.max(ROOM, peak * decay ** i);

const ICARUS_LINE = "That red number is today's change. Gold is down two point three percent since yesterday.";

/**
 * Plays a sequence through the noise floor and the barge-in rule the way the controller does: every frame feeds the
 * floor; while Icarus talks, frames and transcripts also go to the rule. Records when (and if) Icarus was stopped.
 */
function scene() {
  const floor = new NoiseFloor({
    percentile: cfg.floorPercentile,
    windowMs: cfg.floorWindowMs,
    initial: cfg.floorInitial,
    warmupMs: cfg.floorWarmupMs,
  });
  const barge = new BargeInDetector(cfg);
  let t = 0;
  let talking = false;
  const result = { stoppedAt: null as number | null, userStartedAt: null as number | null };
  const s = {
    floor,
    result,
    get now() {
      return t;
    },
    get stopped() {
      return result.stoppedAt !== null;
    },
    /** Icarus starts a line. */
    icarusSays(text = ICARUS_LINE) {
      talking = true;
      barge.begin(text);
      return s;
    },
    /** `ms` of mic audio at a level (a number, or one per frame). */
    mic(ms: number, level: Level) {
      for (let i = 0; i < ms / FRAME_MS; i++) {
        t += FRAME_MS;
        const rms = typeof level === 'function' ? level(i) : level;
        floor.push(rms);
        if (talking && !s.stopped) {
          const done = barge.frame(rms, t, floor.value);
          if (done) Object.assign(result, { stoppedAt: t, userStartedAt: done.startedAt });
        }
      }
      return s;
    },
    /** Scribe sends a transcript now. */
    scribe(text: string) {
      if (talking && !s.stopped) {
        const verdict = barge.words(text, t);
        if (verdict.interrupt) Object.assign(result, { stoppedAt: t, userStartedAt: verdict.startedAt });
      }
      return s;
    },
  };
  return s;
}

/** A quiet room the mic has heard for a while, then Icarus talks. */
const quietRoomWhileIcarusTalks = () => scene().mic(2000, ROOM).icarusSays().mic(500, ROOM);

describe('noise floor', () => {
  const make = () => new NoiseFloor({ percentile: 0.2, windowMs: 5000, initial: 0.005, warmupMs: 500 });

  it('uses the initial level until it has heard half a second of audio', () => {
    const f = make();
    expect(f.value).toBe(0.005);
    for (let i = 0; i < 24; i++) f.push(0.001);
    expect(f.value).toBe(0.005);
    f.push(0.001);
    expect(f.value).toBe(0.001);
  });

  it('is a low percentile: speech, a slam or a cough barely move it', () => {
    const f = make();
    for (let i = 0; i < 150; i++) f.push(ROOM); // 3 s of a quiet room
    for (let i = 0; i < 50; i++) f.push(voice(0.15)(i)); // 1 s of the user talking
    f.push(0.8); // a slam
    expect(f.value).toBe(ROOM);
  });

  it('rises in a noisy room within a few seconds, and comes back down once it is quiet again', () => {
    const f = make();
    for (let i = 0; i < 150; i++) f.push(ROOM);
    const cafe = chatter(0.05);
    for (let i = 0; i < 250; i++) f.push(cafe(i)); // 5 s in a cafe
    expect(f.value).toBeGreaterThan(cfg.minLevel / cfg.levelRatio); // the floor, not the minimum, now sets the bar
    for (let i = 0; i < 250; i++) f.push(ROOM); // 5 s of quiet again
    expect(f.value).toBe(ROOM);
  });

  it('ignores broken levels', () => {
    const f = make();
    for (let i = 0; i < 30; i++) f.push(Number.NaN);
    expect(f.value).toBe(0);
  });
});

describe('real words: wordEvidence', () => {
  const evidence = (text: string) => wordEvidence(text, cfg);

  it('stop words count however short, in English and Thai', () => {
    for (const text of ['Wait, stop!', 'stop', 'hold on', 'no wait', 'หยุด', 'หยุดก่อนครับ', 'เดี๋ยว', 'เดี๋ยวนะ', 'ยกเลิก']) {
      expect(evidence(text), text).toBe('stop_word');
    }
  });

  it('two words, or one word of four letters or more', () => {
    expect(evidence('show me')).toBe('words');
    expect(evidence('what about bitcoin')).toBe('words');
    expect(evidence('Actually')).toBe('long_word');
    expect(evidence("what's")).toBe('long_word');
    expect(evidence('ซื้อทอง')).toBe('words'); // Thai has no spaces: two words, found by the segmenter
    expect(evidence('ขอดูบิตคอยน์แทน')).toBe('words');
  });

  it('noise, fillers, backchannels and sound tags are not words', () => {
    for (const text of ['', '  ', '...', 'no', 'Hm.', 'uh', 'Mm-hmm.', 'uh huh', 'okay yeah', 'Oh!', "I'm", '(coughs)', '[door slams]', '*laughs*', 'อืม', 'ครับ', 'เอ่อ ค่ะ', 'ทอง']) {
      expect(evidence(text), JSON.stringify(text)).toBeNull();
    }
  });
});

describe('barge-in: noise must NOT stop Icarus', () => {
  it('a noise spike, even if Scribe guesses words from it', () => {
    const s = quietRoomWhileIcarusTalks().mic(20, 0.6).mic(800, ROOM).scribe('Thank you.');
    expect(s.stopped).toBe(false);
  });

  it('a door slam: very loud, but over in a moment', () => {
    const s = quietRoomWhileIcarusTalks().mic(400, bang(0.8, 0.65)).mic(600, ROOM).scribe('Oh!').scribe('oh no');
    expect(s.stopped).toBe(false);
  });

  it('a door slam in an echoing hall: loud for long enough, but there are no words', () => {
    const s = quietRoomWhileIcarusTalks().mic(600, bang(0.8, 0.85)).mic(600, ROOM).scribe('Hm.').scribe('[door slams]');
    expect(s.stopped).toBe(false);
  });

  it('a cough, and a coughing fit', () => {
    const cough = bang(0.35, 0.78);
    const s = quietRoomWhileIcarusTalks().mic(300, cough).mic(500, ROOM).scribe('(coughs)');
    for (let i = 0; i < 3; i++) s.mic(300, cough).mic(200, ROOM); // three coughs in a row, short breaths between
    s.scribe('Hm.').scribe('uh huh');
    expect(s.stopped).toBe(false);
  });

  it('steady background chatter at a low level, even though Scribe transcribes it', () => {
    const murmur = chatter(0.016);
    const s = scene().mic(3000, murmur).icarusSays();
    for (const words of ['so I told him', 'so I told him we should', 'so I told him we should leave early']) {
      s.mic(600, murmur).scribe(words);
    }
    expect(s.stopped).toBe(false);
  });

  it('louder chatter in a noisy cafe: the noise floor rises with it', () => {
    const cafe = chatter(0.05);
    const s = scene().mic(4000, cafe).icarusSays();
    for (const words of ['two flat whites please', 'and a croissant', 'for here or to go']) s.mic(700, cafe).scribe(words);
    expect(s.stopped).toBe(false);
    // The fixed minimum alone would not have been enough: the chatter goes above it.
    expect(Array.from({ length: 200 }, (_, i) => cafe(i)).some((v) => v > cfg.minLevel)).toBe(true);
  });

  it('typing: many short clicks are not sustained speech', () => {
    const typing = (i: number) => (i % 7 === 0 ? 0.12 : ROOM);
    const s = quietRoomWhileIcarusTalks().mic(2000, typing).scribe('click click');
    expect(s.stopped).toBe(false);
  });

  it("Icarus's own voice coming back through the mic (echo), even when it is loud and long", () => {
    const s = quietRoomWhileIcarusTalks()
      .mic(1200, voice(0.08))
      .scribe("That red number is today's change")
      .mic(600, voice(0.08))
      .scribe('gold is down two point three percent');
    expect(s.stopped).toBe(false);
  });

  it("Thai: Icarus's own Thai coming back, even spelled a little differently", () => {
    const s = scene().mic(2000, ROOM).icarusSays('ได้เลย ใส่ทอง 1,000 บาท ค่าธรรมเนียม 15 บาท');
    s.mic(1000, voice(0.08)).scribe('ได้เลยใส่ทอง').scribe('ใส่ทองพันบาท');
    expect(s.stopped).toBe(false);
  });

  it('words that came before the loudness: chatter, then a chair scraping', () => {
    const s = quietRoomWhileIcarusTalks().mic(800, chatter(0.016)).scribe('so I told him that').mic(500, 0.1).mic(500, ROOM);
    expect(s.stopped).toBe(false);
  });

  it('words that come too long after the loudness', () => {
    const s = quietRoomWhileIcarusTalks().mic(500, voice(0.12)).mic(cfg.wordsWithinMs + 200, ROOM).scribe('show me bitcoin');
    expect(s.stopped).toBe(false);
  });

  it("loudness from before Icarus's line (the user's own question) does not carry over", () => {
    const barge = new BargeInDetector(cfg);
    let t = 0;
    for (let i = 0; i < 30; i++) barge.frame(0.15, (t += FRAME_MS), ROOM); // the user asks...
    barge.begin(ICARUS_LINE); // ...and Icarus answers
    expect(barge.words('thank you so much', (t += 100))).toEqual({ interrupt: false, reason: 'background' });
  });
});

describe('barge-in: the user really talking DOES stop Icarus', () => {
  it('"wait, stop" at a normal level, with the pause between the words', () => {
    const s = quietRoomWhileIcarusTalks();
    const startedAt = s.now + FRAME_MS;
    s.mic(280, voice(0.12)).mic(120, ROOM).mic(340, voice(0.14)); // "wait," ... "stop"
    expect(s.stopped).toBe(false); // the loudness alone does nothing...
    s.mic(200, ROOM).scribe('wait');
    expect(s.stopped).toBe(true); // ...until Scribe's words arrive
    expect(s.result.userStartedAt).toBe(startedAt); // timed from the first loud frame of "wait"
  });

  it('a two-word sentence at a normal level', () => {
    const s = quietRoomWhileIcarusTalks().mic(700, voice(0.1)).mic(300, ROOM).scribe('show me');
    expect(s.stopped).toBe(true);
  });

  it('one longer word', () => {
    const s = quietRoomWhileIcarusTalks().mic(450, voice(0.1)).mic(400, ROOM).scribe('Actually');
    expect(s.stopped).toBe(true);
  });

  it('Thai stop words: "หยุด" and "เดี๋ยว"', () => {
    for (const word of ['หยุด', 'เดี๋ยว']) {
      const s = scene().mic(2000, ROOM).icarusSays('ตัวเลขสีแดงคือการเปลี่ยนแปลงของวันนี้').mic(500, ROOM);
      s.mic(360, voice(0.12)).mic(500, ROOM).scribe(word);
      expect(s.stopped, word).toBe(true);
    }
  });

  it('a Thai sentence', () => {
    const s = scene().mic(2000, ROOM).icarusSays('ได้เลย ใส่ทอง 1,000 บาท').mic(300, ROOM);
    s.mic(900, voice(0.12)).mic(400, ROOM).scribe('ขอดูบิตคอยน์แทน');
    expect(s.stopped).toBe(true);
  });

  it('words can come first: then the loudness lasting long enough completes it', () => {
    const s = quietRoomWhileIcarusTalks();
    const startedAt = s.now + FRAME_MS;
    s.mic(200, voice(0.12)).scribe('hold on');
    expect(s.stopped).toBe(false); // not loud for long enough yet
    s.mic(200, voice(0.12));
    expect(s.stopped).toBe(true);
    expect(s.result.userStartedAt).toBe(startedAt);
  });

  it('in a noisy cafe, a user speaking to Icarus still gets through', () => {
    const cafe = chatter(0.05);
    const s = scene().mic(4000, cafe).icarusSays().mic(700, cafe).scribe('for here or to go');
    expect(s.stopped).toBe(false);
    s.mic(600, voice(0.25)).mic(300, cafe).scribe('wait a second');
    expect(s.stopped).toBe(true);
  });

  it('the words may arrive a while after the speech ended (Scribe lags the sound)', () => {
    const s = quietRoomWhileIcarusTalks().mic(500, voice(0.12)).mic(cfg.wordsWithinMs - 200, ROOM).scribe('show me bitcoin');
    expect(s.stopped).toBe(true);
  });
});
