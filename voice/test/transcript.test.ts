import { describe, expect, it } from 'vitest';
import { confidenceFromWords, isEchoOf, shouldAcceptFinal, squash } from '../src/shared/transcript';

const cfg = { minConfidence: 0.5, minCharsEn: 4, minCharsTh: 3 };

describe('confidenceFromWords', () => {
  it('turns log probabilities into 0 to 1', () => {
    const c = confidenceFromWords([
      { type: 'word', logprob: -0.1 },
      { type: 'spacing' },
      { type: 'word', logprob: -0.3 },
    ]);
    expect(c).toBeCloseTo(Math.exp(-0.2), 5);
  });
  it('accepts plain probabilities', () => {
    expect(confidenceFromWords([{ type: 'word', logprob: 0.9 }, { type: 'word', logprob: 0.7 }])).toBeCloseTo(0.8, 5);
  });
  it('is null when there is nothing to judge', () => {
    expect(confidenceFromWords(null)).toBeNull();
    expect(confidenceFromWords([])).toBeNull();
    expect(confidenceFromWords([{ type: 'spacing' }])).toBeNull();
  });
  it('is null when the scale is unrecognisable', () => {
    expect(confidenceFromWords([{ type: 'word', logprob: -1 }, { type: 'word', logprob: 5 }])).toBeNull();
  });
});

describe('isEchoOf', () => {
  const saying = "That red number is today's change. Gold is down 2.3 percent since yesterday.";
  it('spots Icarus hearing itself', () => {
    expect(isEchoOf('gold is down 2.3 percent', saying, 8)).toBe(true);
    expect(isEchoOf("That red number is today's", saying, 8)).toBe(true);
  });
  it('never treats short interruptions as echo', () => {
    expect(isEchoOf('stop', 'please stop and think', 8)).toBe(false);
    expect(isEchoOf('wait', saying, 8)).toBe(false);
  });
  it('lets different speech through', () => {
    expect(isEchoOf('take me to bitcoin instead', saying, 8)).toBe(false);
  });
  it('works for Thai', () => {
    expect(isEchoOf('ทองลดลง 2.3', 'วันนี้ ทองลดลง 2.3 เปอร์เซ็นต์', 6)).toBe(true);
  });
});

describe('shouldAcceptFinal', () => {
  const ok = (text: string, confidence: number | null = 0.9, isCommand = false) =>
    shouldAcceptFinal({ text, confidence }, cfg, isCommand);

  it('accepts normal questions', () => {
    expect(ok("what's this red number?").accept).toBe(true);
    expect(ok('gold').accept).toBe(true);
    expect(ok('ทองคืออะไร').accept).toBe(true);
  });
  it('rejects empty and very short fragments', () => {
    expect(ok('')).toEqual({ accept: false, reason: 'empty' });
    expect(ok('uh')).toEqual({ accept: false, reason: 'too_short' });
    expect(ok('ก')).toEqual({ accept: false, reason: 'too_short' });
  });
  it('rejects filler noises', () => {
    expect(ok('okay')).toEqual({ accept: false, reason: 'noise_word' });
    expect(ok('Yeah.')).toEqual({ accept: false, reason: 'noise_word' });
  });
  it('rejects low confidence', () => {
    expect(ok('what is the fee', 0.2)).toEqual({ accept: false, reason: 'low_confidence' });
  });
  it('treats unknown confidence as acceptable for normal turns', () => {
    expect(ok('what is the fee', null).accept).toBe(true);
  });
  it('lets short commands through', () => {
    expect(ok('stop', 0.9, true).accept).toBe(true);
    expect(ok('stop', 0.1, true)).toEqual({ accept: false, reason: 'low_confidence' });
  });
});

describe('squash', () => {
  it('keeps letters and digits only', () => {
    expect(squash('Gold, is down 2.3%!')).toBe('goldisdown23');
  });
});
