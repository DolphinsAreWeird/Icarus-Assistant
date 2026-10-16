// The room's own background level, learned from the mic all the time: while listening AND while Icarus talks.
//
// It is a LOW PERCENTILE of the mic level over the last few seconds, not an average. Speech, coughs and door slams
// are loud for a moment, so they barely move it. A noisy room (a cafe, a hall) raises it within a few seconds, and
// it comes down again when the room goes quiet. Because frames heard while Icarus talks count too, whatever echo the
// browser's echo canceller leaves behind raises the bar for barge-in as well.
//
// Used by the barge-in rule (client/barge-in.ts) and the local voice activity detector (client/vad.ts).
// Numbers: config/defaults.ts, bargeIn.floor*. Time is counted in mic frames, so a busy main thread cannot skew it.

import { MIC_FRAME_MS } from './mic';

export interface NoiseFloorConfig {
  /** Which percentile (0 to 1) of the recent mic levels is the floor. */
  percentile: number;
  /** How much recent audio to look at. */
  windowMs: number;
  /** The floor until warmupMs of audio has been heard. */
  initial: number;
  warmupMs: number;
}

export class NoiseFloor {
  private readonly size: number;
  private readonly warmup: number;
  /** The last `size` levels, oldest first once full (a ring). */
  private readonly ring: number[] = [];
  private oldest = 0;
  /** The same levels, sorted, for the percentile. */
  private readonly sorted: number[] = [];

  constructor(private readonly cfg: NoiseFloorConfig) {
    this.size = Math.max(1, Math.round(cfg.windowMs / MIC_FRAME_MS));
    this.warmup = Math.min(this.size, Math.max(1, Math.round(cfg.warmupMs / MIC_FRAME_MS)));
  }

  /** Feed the level (RMS, 0 to 1) of one mic frame. */
  push(rms: number): void {
    const level = Number.isFinite(rms) && rms > 0 ? rms : 0;
    if (this.ring.length < this.size) {
      this.ring.push(level);
    } else {
      this.sorted.splice(lowerBound(this.sorted, this.ring[this.oldest]!), 1);
      this.ring[this.oldest] = level;
      this.oldest = (this.oldest + 1) % this.size;
    }
    this.sorted.splice(lowerBound(this.sorted, level), 0, level);
  }

  /** The background level now (RMS, 0 to 1). */
  get value(): number {
    const n = this.sorted.length;
    if (n < this.warmup) return this.cfg.initial;
    return this.sorted[Math.min(n - 1, Math.floor(this.cfg.percentile * n))]!;
  }
}

/** Index of the first value that is not below `x`. */
function lowerBound(sorted: number[], x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
