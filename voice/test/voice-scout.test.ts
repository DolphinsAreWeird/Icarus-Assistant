import { describe, expect, it } from 'vitest';
import { estimatePitch } from '../scripts/voice-scout';

/** A voice-like signal: a base pitch with harmonics, a slow vibrato, and pauses. Known answer = `hz`. */
function voice(hz: number, seconds = 3, noise = 0): Int16Array {
  const rate = 16000;
  const out = new Int16Array(rate * seconds);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const speaking = Math.floor(t * 2) % 2 === 0 || t > 2.5; // 0.5 s on, 0.5 s pause
    phase += (2 * Math.PI * hz * (1 + 0.02 * Math.sin(2 * Math.PI * 5 * t))) / rate; // 5 Hz vibrato
    let v = Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase);
    v = (v / 1.75) * (speaking ? 0.5 : 0) + (Math.random() * 2 - 1) * noise;
    out[i] = Math.round(Math.max(-1, Math.min(1, v)) * 32767);
  }
  return out;
}

describe('estimatePitch', () => {
  it.each([100, 130, 180, 220, 260, 320, 400])('finds %i Hz within 5 percent', (hz) => {
    const p = estimatePitch(voice(hz));
    expect(p, `${hz} Hz`).not.toBeNull();
    expect(Math.abs((p as { median: number }).median - hz) / hz).toBeLessThan(0.05);
  });

  it('still finds the pitch with noise on top', () => {
    const p = estimatePitch(voice(240, 3, 0.04));
    expect(Math.abs((p as { median: number }).median - 240) / 240).toBeLessThan(0.06);
  });

  it('ranks a high voice above a low one', () => {
    expect((estimatePitch(voice(280)) as { median: number }).median).toBeGreaterThan((estimatePitch(voice(120)) as { median: number }).median * 2);
  });

  it('says "unknown" for silence and for pure noise instead of inventing a pitch', () => {
    expect(estimatePitch(new Int16Array(16000 * 2))).toBeNull();
    const noise = new Int16Array(16000 * 2).map(() => Math.round((Math.random() * 2 - 1) * 8000));
    expect(estimatePitch(noise)).toBeNull();
  });
});
