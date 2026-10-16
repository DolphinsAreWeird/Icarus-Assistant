// Local voice activity detection, based on how loud the mic is. No network, no model.
//
// Used for TIMING only:
//   1. when did the user stop speaking (for the latency numbers)
//   2. knowing when an utterance started (the echo check, and so an early "confirm" can be rejected)
//
// It never stops Icarus: barge-in is decided in barge-in.ts, which needs real words too.
// It is NOT the thing that decides the user is done either. Scribe's own VAD does that.
// Loud means: louder than the room's noise floor (noise-floor.ts, shared with barge-in) times a ratio, and above a minimum.
// While Icarus is speaking we use a bigger ratio so the speaker's echo does not count.

export interface VadConfig {
  /** Quiet this long after speech means speech ended. */
  hangoverMs: number;
  /** Loud for this long before we call it speech. */
  onsetMs: number;
  minRms: number;
  ratio: number;
  ratioWhileSpeaking: number;
}

/** Where the room's background level comes from (noise-floor.ts). */
export interface FloorSource {
  readonly value: number;
}

export type VadEvent = 'speech_start' | 'speech_end';

export class EnergyVad {
  private aboveSince: number | null = null;
  private inSpeech = false;
  /** Last time a frame was loud enough. */
  lastLoudAt: number | null = null;
  /** When the current (or last) stretch of loudness began. */
  speechStartedAt: number | null = null;

  constructor(
    private readonly cfg: VadConfig,
    private readonly floor: FloorSource,
  ) {}

  get speaking(): boolean {
    return this.inSpeech;
  }

  get background(): number {
    return this.floor.value;
  }

  threshold(icarusSpeaking: boolean): number {
    const ratio = icarusSpeaking ? this.cfg.ratioWhileSpeaking : this.cfg.ratio;
    return Math.max(this.cfg.minRms, this.floor.value * ratio);
  }

  /** Feed one frame (about 20 ms). `nowMs` is any steadily increasing clock. */
  push(rms: number, nowMs: number, icarusSpeaking = false): VadEvent | null {
    const loud = rms > this.threshold(icarusSpeaking);

    if (loud) {
      this.lastLoudAt = nowMs;
      if (this.aboveSince === null) this.aboveSince = nowMs;
      if (!this.inSpeech && nowMs - this.aboveSince >= this.cfg.onsetMs) {
        this.inSpeech = true;
        this.speechStartedAt = this.aboveSince;
        return 'speech_start';
      }
      return null;
    }

    if (!this.inSpeech) {
      this.aboveSince = null;
      return null;
    }

    if (this.lastLoudAt !== null && nowMs - this.lastLoudAt >= this.cfg.hangoverMs) {
      this.inSpeech = false;
      this.aboveSince = null;
      return 'speech_end';
    }
    return null;
  }
}
