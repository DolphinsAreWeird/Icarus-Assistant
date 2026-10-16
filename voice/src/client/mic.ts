// Microphone capture. Turns the mic into 20 ms frames of 16 kHz, 16-bit mono PCM (what Scribe
// wants) plus a loudness number for each frame (used by the local voice activity detector).
//
// An AudioWorklet does the work off the main thread. Its code is kept in a string and loaded
// from a Blob, so there is no extra file to host.

/** Every mic frame is this long (320 samples at 16 kHz). The noise floor and barge-in count time in frames. */
export const MIC_FRAME_MS = 20;

export interface MicFrame {
  /** 320 samples = 20 ms at 16 kHz. */
  pcm: Int16Array;
  /** Loudness of this frame, 0 to 1. */
  rms: number;
}

export interface MicPort {
  start(onFrame: (frame: MicFrame) => void): Promise<void>;
  stop(): void;
}

const WORKLET_SOURCE = `
class Pcm16kProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000; // input samples per output sample
    this.pos = 0;
    this.acc = 0;
    this.count = 0;
    this.out = new Int16Array(320);
    this.filled = 0;
    this.sumSquares = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      // Average the input samples that fall into one output sample (a simple low-pass).
      this.acc += channel[i];
      this.count++;
      this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        const v = Math.max(-1, Math.min(1, this.acc / this.count));
        this.acc = 0;
        this.count = 0;
        this.sumSquares += v * v;
        this.out[this.filled++] = v < 0 ? v * 32768 : v * 32767;
        if (this.filled === 320) {
          this.port.postMessage({ pcm: this.out.slice(), rms: Math.sqrt(this.sumSquares / 320) });
          this.filled = 0;
          this.sumSquares = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('icarus-pcm16k', Pcm16kProcessor);
`;

export class WebMic implements MicPort {
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private moduleLoaded = false;

  /** `getContext` returns the shared AudioContext (created from a user gesture). */
  constructor(private readonly getContext: () => AudioContext) {}

  async start(onFrame: (frame: MicFrame) => void): Promise<void> {
    const ctx = this.getContext();
    // Echo cancellation matters: without it Icarus hears itself and cuts itself off.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    if (!this.moduleLoaded) {
      const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      this.moduleLoaded = true;
    }
    this.source = ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(ctx, 'icarus-pcm16k', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    this.node.port.onmessage = (e: MessageEvent<MicFrame>) => onFrame(e.data);
    // Some browsers skip nodes that are not connected to the output. Connect through a muted gain.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    this.source.connect(this.node);
    this.node.connect(mute);
    mute.connect(ctx.destination);
  }

  stop(): void {
    this.node?.port.close();
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node = null;
    this.source = null;
    this.stream = null;
  }
}
