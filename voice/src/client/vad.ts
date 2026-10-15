// Local voice activity detection, based on how loud the mic is. No network, no model.
//
// Used for three things:
//   1. barge-in: the user starts talking while Icarus is talking
//   2. timing: when did the user stop speaking (for the latency numbers)
//   3. knowing when an utterance started (so an early "confirm" can be rejected)
//
// This is NOT the thing that decides the user is done. Scribe's own VAD does that.
// Loud means: louder than the learned background level times a ratio, and above a floor.
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

export type VadEvent = 'speech_start' | 'speech_end';

export class EnergyVad {
  private noiseFloor = 0.004;
  private aboveSince: number | null = null;
  private inSpeech = false;
  /** Last time a frame was loud enough. */
  lastLoudAt: number | null = null;
  /** When the current (or last) stretch of loudness began. */
  speechStartedAt: number | null = null;

  constructor(private readonly cfg: VadConfig) {}

  get speaking(): boolean {
    return this.inSpeech;
  }

  get background(): number {
    return this.noiseFloor;
  }

  threshold(icarusSpeaking: boolean): number {
    const ratio = icarusSpeaking ? this.cfg.ratioWhileSpeaking : this.cfg.ratio;
    return Math.max(this.cfg.minRms, this.noiseFloor * ratio);
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
      // Learn the background level, but never from echo of our own voice.
      if (!icarusSpeaking) this.noiseFloor = this.noiseFloor * 0.95 + rms * 0.05;
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
