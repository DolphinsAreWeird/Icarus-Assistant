// The Scribe v2 Realtime socket. Connects straight to ElevenLabs with the single-use token URL
// the server gave us. Sends mic audio, emits partial and final transcripts.
//
// "Final" waits briefly for the timestamped version of the committed transcript, because only
// that one carries per-word confidence. If it does not arrive in time we still emit the final
// text, with confidence null. Callers treat null as "not high".

import { audioFrame, commitFrame, parseSttMessage, STT_SAMPLE_RATE, redactUrl } from '../shared/stt-protocol';
import { confidenceFromWords } from '../shared/transcript';
import { Emitter } from './emitter';

export interface SttFinal {
  text: string;
  confidence: number | null;
  /** As reported by Scribe, for example "eng" or "tha". null if unknown. */
  languageCode: string | null;
}

export interface SttEvents {
  partial: string;
  final: SttFinal;
  error: { code: string; message: string };
  /** `requested` is true when we closed it on purpose. */
  close: { requested: boolean };
}

/** The part of SttClient the controller uses. Tests provide a fake. */
export interface SttPort {
  on<K extends keyof SttEvents>(event: K, handler: (payload: SttEvents[K]) => void): () => void;
  connect(url: string): Promise<void>;
  readonly isOpen: boolean;
  readonly secondsSent: number;
  sendAudio(frame: Int16Array): void;
  /** Send any buffered audio, then tell Scribe the segment is over (push-to-talk). */
  commit(): void;
  close(): void;
}

type WebSocketLike = Pick<WebSocket, 'send' | 'close' | 'readyState'> & {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
};

export interface SttClientOptions {
  /** How long to wait for word confidence after a committed transcript. */
  confidenceWaitMs?: number;
  /** Replace the WebSocket (tests). */
  createSocket?: (url: string) => WebSocketLike;
}

const FRAMES_PER_MESSAGE = 5; // 5 x 20 ms = 100 ms per message (Scribe wants 0.1 to 1 s)

export class SttClient extends Emitter<SttEvents> implements SttPort {
  private ws: WebSocketLike | null = null;
  private open = false;
  private closeRequested = false;
  private batch: Int16Array[] = [];
  private pendingCommit: { text: string; timer: ReturnType<typeof setTimeout> } | null = null;
  private recentFinals: Array<{ text: string; at: number }> = [];
  private samplesSent = 0;

  constructor(private readonly opts: SttClientOptions = {}) {
    super();
  }

  get isOpen(): boolean {
    return this.open;
  }

  get secondsSent(): number {
    return this.samplesSent / STT_SAMPLE_RATE;
  }

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        reject(new Error(message));
      };
      const timeout = setTimeout(() => fail('Speech-to-text did not start in time.'), 8000);

      const ws = this.opts.createSocket ? this.opts.createSocket(url) : (new WebSocket(url) as unknown as WebSocketLike);
      this.ws = ws;
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        const msg = parseSttMessage(ev.data);
        if (!msg) return;
        switch (msg.kind) {
          case 'session_started':
            this.open = true;
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              resolve();
            }
            break;
          case 'partial':
            if (msg.text.trim()) this.emit('partial', msg.text);
            break;
          case 'committed':
            this.onCommitted(msg.text);
            break;
          case 'committed_with_timestamps':
            this.onCommittedWithTimestamps(msg.text, msg.languageCode, confidenceFromWords(msg.words));
            break;
          case 'error':
            if (!settled) {
              clearTimeout(timeout);
              fail(msg.message);
            }
            this.emit('error', { code: msg.code, message: msg.message });
            break;
          default:
            break;
        }
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        fail(`Could not connect to speech-to-text (${redactUrl(url).slice(0, 60)}...)`);
      };
      ws.onclose = () => {
        clearTimeout(timeout);
        const wasOpen = this.open;
        this.open = false;
        fail('Speech-to-text closed before it started.');
        if (wasOpen || settled) this.emit('close', { requested: this.closeRequested });
      };
    });
  }

  /** Buffer a 20 ms frame. Every 100 ms of audio goes out as one message. */
  sendAudio(frame: Int16Array): void {
    if (!this.open) return;
    this.batch.push(frame);
    if (this.batch.length >= FRAMES_PER_MESSAGE) this.flush(false);
  }

  commit(): void {
    if (!this.open) return;
    this.flush(true);
  }

  close(): void {
    this.closeRequested = true;
    if (this.pendingCommit) {
      clearTimeout(this.pendingCommit.timer);
      this.pendingCommit = null;
    }
    this.open = false;
    try {
      this.ws?.close();
    } catch {
      // Already closed.
    }
  }

  // ---------------------------------------------------------------------------

  private flush(commit: boolean): void {
    if (!this.ws || !this.open) return;
    const samples = this.batch.reduce((n, f) => n + f.length, 0);
    const merged = new Int16Array(samples);
    let offset = 0;
    for (const frame of this.batch) {
      merged.set(frame, offset);
      offset += frame.length;
    }
    this.batch = [];
    this.samplesSent += samples;
    if (samples > 0) {
      const bytes = new Uint8Array(merged.buffer, merged.byteOffset, merged.byteLength);
      this.ws.send(audioFrame(bytes, false));
    }
    if (commit) this.ws.send(commitFrame());
  }

  private onCommitted(text: string): void {
    if (!text.trim()) return;
    if (this.alreadyEmitted(text)) return;
    // Hold it for a moment. The timestamped version usually follows right behind.
    if (this.pendingCommit) {
      clearTimeout(this.pendingCommit.timer);
      this.release(this.pendingCommit.text, null, null);
    }
    const wait = this.opts.confidenceWaitMs ?? 400;
    const timer = setTimeout(() => {
      const pending = this.pendingCommit;
      this.pendingCommit = null;
      if (pending) this.release(pending.text, null, null);
    }, wait);
    this.pendingCommit = { text, timer };
  }

  private onCommittedWithTimestamps(text: string, languageCode: string | null, confidence: number | null): void {
    if (!text.trim()) return;
    if (this.pendingCommit) {
      clearTimeout(this.pendingCommit.timer);
      this.pendingCommit = null;
    }
    if (this.alreadyEmitted(text)) return;
    this.release(text, confidence, languageCode);
  }

  private release(text: string, confidence: number | null, languageCode: string | null): void {
    this.recentFinals.push({ text: text.trim(), at: Date.now() });
    this.recentFinals = this.recentFinals.filter((f) => Date.now() - f.at < 3000);
    this.emit('final', { text: text.trim(), confidence, languageCode });
  }

  /** The same final can arrive twice (plain and timestamped). Emit it once. */
  private alreadyEmitted(text: string): boolean {
    const t = text.trim();
    return this.recentFinals.some((f) => f.text === t && Date.now() - f.at < 3000);
  }
}
