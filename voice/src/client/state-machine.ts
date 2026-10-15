// The conversation state. One place, five states, explicit rules about what can follow what.
//
//   idle        mic off (or push-to-talk waiting for the button)
//   listening   mic on, waiting for the user or hearing them
//   thinking    got the user's words, waiting for the assistant and the first audio
//   speaking    Icarus is talking
//   confirming  a money preview is pending. Sub-steps (confirmPhase):
//                 readback   Icarus is reading the preview. Confirm is NOT accepted yet.
//                 awaiting   read-back finished. Waiting for "confirm" or "cancel".
//                 countdown  the user said confirm. 3 second visible countdown. Cancel works.

import type { ConfirmPhase, VoiceEvents, VoiceState } from '../shared/types';

const ALLOWED: Record<VoiceState, VoiceState[]> = {
  idle: ['listening', 'thinking', 'speaking'],
  listening: ['idle', 'thinking', 'speaking'],
  thinking: ['idle', 'listening', 'speaking', 'confirming'],
  speaking: ['idle', 'listening', 'thinking', 'confirming'],
  confirming: ['idle', 'listening', 'thinking'],
};

export type StateChange = VoiceEvents['stateChange'];

export class VoiceStateMachine {
  private current: VoiceState = 'idle';
  private phase: ConfirmPhase | null = null;

  constructor(
    private readonly onChange: (change: StateChange) => void,
    private readonly onIllegal: (from: VoiceState, to: VoiceState, reason: string) => void = () => undefined,
  ) {}

  get state(): VoiceState {
    return this.current;
  }

  get confirmPhase(): ConfirmPhase | null {
    return this.phase;
  }

  /** Move to a new state. Returns false (and does nothing) if the move is not allowed. */
  to(next: VoiceState, reason: string, confirmPhase: ConfirmPhase | null = null): boolean {
    const nextPhase = next === 'confirming' ? (confirmPhase ?? 'readback') : null;
    if (next === this.current) {
      if (nextPhase !== this.phase) this.setPhase(nextPhase, reason);
      return true;
    }
    if (!ALLOWED[this.current].includes(next)) {
      this.onIllegal(this.current, next, reason);
      return false;
    }
    const from = this.current;
    this.current = next;
    this.phase = nextPhase;
    this.onChange({ from, to: next, reason, confirmPhase: this.phase });
    return true;
  }

  /** Change the sub-step inside 'confirming'. Emits a stateChange with from = to = 'confirming'. */
  setPhase(phase: ConfirmPhase | null, reason: string): void {
    if (this.current !== 'confirming' || phase === this.phase || phase === null) return;
    this.phase = phase;
    this.onChange({ from: 'confirming', to: 'confirming', reason, confirmPhase: phase });
  }
}
