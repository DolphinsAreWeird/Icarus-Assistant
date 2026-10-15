// A pretend microphone for the test page. It sends frames of quiet noise, or loud noise while
// "talking" is on. With the fake Scribe (FAKE_ELEVENLABS=1) this lets you run the whole
// hands-free flow, including barge-in and the confirm countdown, with no real microphone.

import type { MicFrame, MicPort } from './mic';

export class SyntheticMic implements MicPort {
  talking = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  async start(onFrame: (frame: MicFrame) => void): Promise<void> {
    this.timer = setInterval(() => {
      const amplitude = this.talking ? 0.25 : 0.003;
      const pcm = new Int16Array(320);
      let sum = 0;
      for (let i = 0; i < pcm.length; i++) {
        const v = (Math.random() * 2 - 1) * amplitude;
        pcm[i] = Math.round(v * 32767);
        sum += v * v;
      }
      onFrame({ pcm, rms: Math.sqrt(sum / pcm.length) });
    }, 20);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.talking = false;
  }

  setTalking(talking: boolean): void {
    this.talking = talking;
  }
}
