// The money confirmation flow. This is the safety-critical part, so it is small, pure and tested.
//
//   begin(preview) -> readback -> awaiting -> countdown -> confirm intent
//
// THE RULES (context.md section 5):
//   1. A spoken "confirm" is IGNORED until the read-back has finished playing. It can never
//      start the countdown early. Only readbackFinished() opens the door, and the controller
//      calls that only when the audio ended naturally (never when it was stopped or failed).
//   2. "confirm" needs HIGH transcript confidence. Unknown confidence counts as not high.
//   3. The user must have STARTED speaking after the read-back ended. Words said during the
//      read-back do not count, even if the transcript arrives late.
//   4. "confirm" must be the whole utterance (exact phrase). "yes" and "ok" never confirm.
//   5. Cancel is always accepted: by voice, by tap, at any time, at any confidence.
//   6. This class NEVER executes anything. At the end it only reports a confirm INTENT.
//      The frontend and the assistant decide what happens next. Voice is not authentication
//      (hard rule 4), so the intent says requiresTap: true unless the config says otherwise.

import type { CommandName } from '../config/voice-commands';
import { matchCommand } from '../shared/commands';
import type {
  ConfirmIntentEvent,
  ConfirmPhase,
  CountdownEvent,
  FinalTranscript,
  TradePreview,
} from '../shared/types';

export interface ConfirmConfig {
  /** Minimum confidence (0 to 1) for a spoken "confirm". */
  minConfidence: number;
  countdownMs: number;
  /** How long to wait for confirm or cancel after the read-back before dropping the voice flow. */
  awaitTimeoutMs: number;
  /** Goes into the confirm intent. Leave true: voice is never approval. */
  requiresTap: boolean;
  /** Which kinds of input may start a countdown. Real use: ['voice']. Tests and the demo page may add 'simulated'. */
  acceptedSources: ReadonlyArray<FinalTranscript['source']>;
}

/** Clock and timers, injected so tests can run time by hand. */
export interface TimerPort {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ConfirmHooks {
  onPhase(phase: ConfirmPhase | null, reason: string): void;
  onCountdown(event: CountdownEvent): void;
  onIntent(event: ConfirmIntentEvent): void;
  /** Cancelled (voice, tap or stop). The controller speaks "Okay, cancelled." for voice. */
  onCancelled(info: { previewId: string; by: 'voice' | 'tap' | 'stopped'; wasCounting: boolean }): void;
  onExpired(previewId: string): void;
}

export type ConfirmOutcome =
  | 'cancelled' // the preview was cancelled
  | 'repeat' // read the preview again
  | 'unclear' // heard something confirm-like but not safe to act on: ask again
  | 'confirmed' // countdown started
  | 'too_early' // said "confirm" before the read-back finished. Not accepted. Read the preview again from the start.
  | 'ignored' // nothing to do
  | 'passthrough'; // not about the preview: the flow is over, treat it as a normal question

export class ConfirmFlow {
  private currentPhase: ConfirmPhase | null = null;
  private preview: TradePreview | null = null;
  private readbackEndedAt: number | null = null;
  private timers: unknown[] = [];
  private countdownStartedAt = 0;

  constructor(
    private readonly cfg: ConfirmConfig,
    private readonly timer: TimerPort,
    private readonly hooks: ConfirmHooks,
  ) {}

  get phase(): ConfirmPhase | null {
    return this.currentPhase;
  }

  get previewId(): string | null {
    return this.preview?.preview_id ?? null;
  }

  /** A money preview arrived. The read-back is about to start. */
  begin(preview: TradePreview): void {
    this.clearTimers();
    this.preview = preview;
    this.readbackEndedAt = null;
    this.setPhase('readback', 'preview_ready');
  }

  /** The read-back audio started (again). Confirm stays blocked until it finishes. */
  readbackStarted(): void {
    if (this.currentPhase === 'countdown' || this.currentPhase === null) return;
    this.clearTimers();
    this.readbackEndedAt = null;
    this.setPhase('readback', 'readback_started');
  }

  /**
   * The read-back audio ENDED NATURALLY. Call this only for a finished playback, never for a
   * stopped, failed or interrupted one. This is the only door into the 'awaiting' phase.
   */
  readbackFinished(): void {
    if (this.currentPhase !== 'readback') return;
    this.readbackEndedAt = this.timer.now();
    this.setPhase('awaiting', 'readback_finished');
    this.startAwaitTimer();
  }

  /** Decide what an utterance means for the pending preview. */
  handleUtterance(t: Pick<FinalTranscript, 'text' | 'confidence' | 'source' | 'speechStartedAt'>): ConfirmOutcome {
    const phase = this.currentPhase;
    if (!phase) return 'passthrough';

    if (phase === 'countdown') {
      const cmd = matchCommand(t.text, ['cancel', 'stop']);
      if (cmd) {
        this.doCancel('voice');
        return 'cancelled';
      }
      return 'ignored';
    }

    const allowed: CommandName[] = phase === 'awaiting' ? ['cancel', 'confirm', 'repeat', 'stop'] : ['cancel', 'repeat', 'stop', 'confirm'];
    const cmd = matchCommand(t.text, allowed);

    switch (cmd) {
      case 'cancel':
        this.doCancel('voice');
        return 'cancelled';
      case 'repeat':
        return 'repeat';
      case 'stop':
        // "wait" means "give me a moment". Keep the preview, restart the waiting time.
        if (phase === 'awaiting') this.startAwaitTimer();
        return 'ignored';
      case 'confirm':
        if (phase === 'readback') return 'too_early'; // RULE 1: not accepted. The caller reads the preview again.
        return this.tryConfirm(t);
      default:
        // Something else: the user moved on. End the voice flow. The card stays on screen.
        this.finish('superseded');
        return 'passthrough';
    }
  }

  /** Cancel from outside (the tap button, or the voice session being stopped). */
  cancel(by: 'tap' | 'stopped' | 'voice'): boolean {
    if (!this.currentPhase) return false;
    this.doCancel(by);
    return true;
  }

  /** The UI says it dealt with the preview (executed or cancelled by tap). End the voice flow quietly. */
  resolved(): void {
    if (this.currentPhase) this.finish('resolved_by_ui');
  }

  dispose(): void {
    this.clearTimers();
    this.currentPhase = null;
    this.preview = null;
  }

  // ---------------------------------------------------------------------------

  private tryConfirm(t: Pick<FinalTranscript, 'confidence' | 'source' | 'speechStartedAt'>): ConfirmOutcome {
    if (!this.cfg.acceptedSources.includes(t.source)) return this.rejectSource();

    const confident = t.confidence !== null && t.confidence >= this.cfg.minConfidence; // RULE 2
    const spokenAfterReadback = // RULE 3
      t.speechStartedAt !== null && this.readbackEndedAt !== null && t.speechStartedAt >= this.readbackEndedAt;
    if (!confident || !spokenAfterReadback) return 'unclear';

    this.startCountdown();
    return 'confirmed';
  }

  /** Typed text can never start a countdown. Treat it as a normal message. */
  private rejectSource(): ConfirmOutcome {
    this.finish('superseded');
    return 'passthrough';
  }

  private startCountdown(): void {
    if (!this.preview) return;
    this.clearTimers();
    const previewId = this.preview.preview_id;
    const total = this.cfg.countdownMs;
    this.countdownStartedAt = this.timer.now();
    this.setPhase('countdown', 'confirm_heard');
    this.hooks.onCountdown(this.countdownEvent('start', total, previewId));

    // A tick at every whole second that is left, then 'done' at the end.
    for (let elapsed = 1000; elapsed < total; elapsed += 1000) {
      this.timers.push(
        this.timer.setTimeout(() => {
          this.hooks.onCountdown(this.countdownEvent('tick', total - elapsed, previewId));
        }, elapsed),
      );
    }
    this.timers.push(
      this.timer.setTimeout(() => {
        this.timers = [];
        this.hooks.onCountdown(this.countdownEvent('done', 0, previewId));
        // The ONLY output of the whole flow: an intent. We execute nothing.
        this.hooks.onIntent({ previewId, source: 'voice', requiresTap: this.cfg.requiresTap });
        this.finish('intent_sent');
      }, total),
    );
  }

  private doCancel(by: 'voice' | 'tap' | 'stopped'): void {
    const previewId = this.preview?.preview_id ?? '';
    const wasCounting = this.currentPhase === 'countdown';
    const total = this.cfg.countdownMs;
    const remaining = wasCounting ? Math.max(0, total - (this.timer.now() - this.countdownStartedAt)) : total;
    this.clearTimers();
    this.hooks.onCountdown({ ...this.countdownEvent('cancelled', remaining, previewId), cancelledBy: by, wasCounting });
    this.finish('cancelled');
    this.hooks.onCancelled({ previewId, by, wasCounting });
  }

  private startAwaitTimer(): void {
    this.clearTimers();
    const previewId = this.preview?.preview_id ?? '';
    this.timers.push(
      this.timer.setTimeout(() => {
        this.timers = [];
        this.finish('expired');
        this.hooks.onExpired(previewId);
      }, this.cfg.awaitTimeoutMs),
    );
  }

  private countdownEvent(phase: CountdownEvent['phase'], remainingMs: number, previewId: string): CountdownEvent {
    return {
      phase,
      previewId,
      totalMs: this.cfg.countdownMs,
      remainingMs,
      secondsLeft: Math.ceil(remainingMs / 1000),
    };
  }

  private finish(reason: string): void {
    this.clearTimers();
    this.currentPhase = null;
    this.preview = null;
    this.readbackEndedAt = null;
    this.hooks.onPhase(null, reason);
  }

  private setPhase(phase: ConfirmPhase, reason: string): void {
    this.currentPhase = phase;
    this.hooks.onPhase(phase, reason);
  }

  private clearTimers(): void {
    for (const handle of this.timers) this.timer.clearTimeout(handle);
    this.timers = [];
  }
}
