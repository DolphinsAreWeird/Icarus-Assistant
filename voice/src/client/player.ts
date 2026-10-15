// Plays streamed audio the moment the first chunk arrives, and stops it INSTANTLY.
//
// The server sends raw 16-bit PCM. Each chunk becomes a tiny Web Audio buffer scheduled right
// after the previous one, so playback is gapless and starts before the reply is finished.
// stop() mutes and cancels every scheduled buffer, which is what makes barge-in fast.

export interface PlaybackHandle {
  /** Add raw 16-bit little-endian mono PCM bytes. Chunks may split a sample. */
  push(chunk: Uint8Array): void;
  /** No more audio is coming. */
  end(): void;
  /** Silence now. Safe to call twice. */
  stop(): void;
  /** 'finished': all audio played to the end. 'stopped': cut short. */
  readonly finished: Promise<'finished' | 'stopped'>;
}

export interface AudioOutput {
  /** Start a new playback. `onFirstAudio` fires when sound starts. */
  begin(sampleRate: number, onFirstAudio: () => void): PlaybackHandle;
  /** 1 is normal. Above 1 is louder and can distort. */
  setVolume(volume: number): void;
}

export class WebAudioOutput implements AudioOutput {
  private readonly master: GainNode;

  constructor(
    private readonly ctx: AudioContext,
    private readonly startLeadMs = 40,
  ) {
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
  }

  setVolume(volume: number): void {
    this.master.gain.value = volume;
  }

  begin(sampleRate: number, onFirstAudio: () => void): PlaybackHandle {
    const ctx = this.ctx;
    const lead = this.startLeadMs;
    const gain = ctx.createGain(); // one per playback, so stop() can mute it without touching the next one
    gain.connect(this.master);

    const sources = new Set<AudioBufferSourceNode>();
    let nextStart = 0;
    let leftover: number | null = null; // a lone byte at the end of a chunk
    let ended = false;
    let stopped = false;
    let firstAudio = false;
    let settle: (r: 'finished' | 'stopped') => void = () => undefined;
    const finished = new Promise<'finished' | 'stopped'>((resolve) => {
      settle = resolve;
    });

    const maybeFinish = () => {
      if (ended && sources.size === 0 && !stopped) settle('finished');
    };

    const handle: PlaybackHandle = {
      finished,

      push(chunk: Uint8Array) {
        if (stopped || chunk.byteLength === 0) return;
        // Join a leftover byte from the last chunk, if there is one.
        let bytes = chunk;
        if (leftover !== null) {
          bytes = new Uint8Array(chunk.byteLength + 1);
          bytes[0] = leftover;
          bytes.set(chunk, 1);
          leftover = null;
        }
        if (bytes.byteLength % 2 === 1) {
          leftover = bytes[bytes.byteLength - 1] ?? null;
          bytes = bytes.subarray(0, bytes.byteLength - 1);
        }
        const samples = bytes.byteLength / 2;
        if (samples === 0) return;

        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const buffer = ctx.createBuffer(1, samples, sampleRate);
        const channel = buffer.getChannelData(0);
        for (let i = 0; i < samples; i++) channel[i] = view.getInt16(i * 2, true) / 32768;

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(gain);
        const startAt = Math.max(nextStart, ctx.currentTime + (firstAudio ? 0.005 : lead / 1000));
        source.onended = () => {
          sources.delete(source);
          maybeFinish();
        };
        source.start(startAt);
        sources.add(source);
        nextStart = startAt + buffer.duration;

        if (!firstAudio) {
          firstAudio = true;
          const wait = Math.max(0, (startAt - ctx.currentTime) * 1000);
          setTimeout(() => !stopped && onFirstAudio(), wait);
        }
      },

      end() {
        ended = true;
        maybeFinish();
      },

      stop() {
        if (stopped) return;
        stopped = true;
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setValueAtTime(0, ctx.currentTime); // mute first: no click, no tail
        for (const source of sources) {
          source.onended = null;
          try {
            source.stop();
          } catch {
            // Already stopped.
          }
          source.disconnect();
        }
        sources.clear();
        gain.disconnect();
        settle('stopped');
      },
    };
    return handle;
  }
}
