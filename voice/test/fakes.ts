// Fakes for testing the browser controller without a browser, a mic or a network.
import type { AudioOutput, PlaybackHandle } from '../src/client/player';
import type { MicFrame, MicPort } from '../src/client/mic';
import type { SttEvents, SttPort } from '../src/client/stt-client';
import type { TimerPort } from '../src/client/confirm-flow';
import type { VoiceApiPort, TtsResponse } from '../src/client/api';
import type { AskResponse, AssistantReply, Lang, TurnMetrics } from '../src/shared/types';
import { planSpeech } from '../src/server/speech-plan';
import { MockAssistant } from '../src/server/assistant/mock';

/** Time only moves when the test says so. */
export class FakeTimers implements TimerPort {
  t = 1000;
  private next = 1;
  private pending = new Map<number, { at: number; fn: () => void }>();
  now() { return this.t; }
  setTimeout(fn: () => void, ms: number) { const id = this.next++; this.pending.set(id, { at: this.t + ms, fn }); return id; }
  clearTimeout(h: unknown) { this.pending.delete(h as number); }
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const due = [...this.pending.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.pending.delete(due[0]);
      this.t = due[1].at;
      due[1].fn();
    }
    this.t = end;
  }
}

export class FakeStt implements SttPort {
  isOpen = false;
  secondsSent = 0;
  audioFrames = 0;
  commits = 0;
  closed = false;
  url = '';
  failConnect = false;
  private handlers: { [K in keyof SttEvents]?: Array<(p: SttEvents[K]) => void> } = {};
  on<K extends keyof SttEvents>(event: K, handler: (payload: SttEvents[K]) => void) {
    ((this.handlers[event] ??= []) as Array<(p: SttEvents[K]) => void>).push(handler);
    return () => undefined;
  }
  async connect(url: string) {
    this.url = url;
    if (this.failConnect) throw new Error('connect failed');
    this.isOpen = true;
  }
  sendAudio(frame: Int16Array) { this.audioFrames++; this.secondsSent += frame.length / 16000; }
  commit() { this.commits++; }
  close() { this.closed = true; this.isOpen = false; this.fire('close', { requested: true }); }
  fire<K extends keyof SttEvents>(event: K, payload: SttEvents[K]) { for (const h of (this.handlers[event] ?? []) as Array<(p: SttEvents[K]) => void>) h(payload); }
  /** Pretend the network dropped. */
  drop() { this.isOpen = false; this.fire('close', { requested: false }); }
  partial(text: string) { this.fire('partial', text); }
  final(text: string, confidence: number | null = 0.95, languageCode: string | null = null) { this.fire('final', { text, confidence, languageCode }); }
}

export class FakeMic implements MicPort {
  onFrame: ((f: MicFrame) => void) | null = null;
  started = false;
  denied = false;
  async start(onFrame: (f: MicFrame) => void) {
    if (this.denied) throw new Error('Permission denied');
    this.onFrame = onFrame;
    this.started = true;
  }
  stop() { this.started = false; this.onFrame = null; }
  /** Send `ms` of audio at a loudness. Loudness above ~0.05 counts as speech. */
  feed(timers: FakeTimers, rms: number, ms: number) {
    for (let i = 0; i < ms / 20; i++) {
      timers.advance(20);
      this.onFrame?.({ pcm: new Int16Array(320), rms });
    }
  }
}

export class FakePlayback implements PlaybackHandle {
  pushed = 0;
  ended = false;
  stopped = false;
  private settle!: (r: 'finished' | 'stopped') => void;
  finished = new Promise<'finished' | 'stopped'>((r) => { this.settle = r; });
  constructor(public readonly sampleRate: number, private readonly onFirst: () => void) {}
  push(chunk: Uint8Array) {
    if (this.stopped) return;
    if (this.pushed === 0) queueMicrotask(() => !this.stopped && this.onFirst());
    this.pushed += chunk.byteLength;
  }
  end() { this.ended = true; }
  stop() { if (this.stopped) return; this.stopped = true; this.settle('stopped'); }
  /** The audio played to its natural end. */
  finishNaturally() { if (!this.stopped) this.settle('finished'); }
}

export class FakeOutput implements AudioOutput {
  playbacks: FakePlayback[] = [];
  volume = 1;
  begin(sampleRate: number, onFirstAudio: () => void) { const p = new FakePlayback(sampleRate, onFirstAudio); this.playbacks.push(p); return p; }
  setVolume(v: number) { this.volume = v; }
  get last() { return this.playbacks[this.playbacks.length - 1]!; }
}

/** The real mock assistant and the real speech planner, with no HTTP in between. */
export class FakeApi implements VoiceApiPort {
  asks: Array<{ text: string; language: string; snapshot?: unknown; userId: string }> = [];
  ttsRequests: Array<{ text: string; language: Lang; speed: number }> = [];
  friction: unknown[] = [];
  metrics: TurnMetrics[] = [];
  usageReports: number[] = [];
  tokenRequests: Array<{ language: string; mode: string }> = [];
  ttsFails = false;
  ttsDelayMs = 0;
  askOverride: ((text: string) => AssistantReply) | null = null;
  private readonly mock = new MockAssistant(0);

  async scribeToken(language: string, mode: string) {
    this.tokenRequests.push({ language, mode });
    return { url: `wss://example.test/stt?lang=${language}&mode=${mode}`, commitStrategy: mode === 'push-to-talk' ? ('manual' as const) : ('vad' as const), expiresInSec: 900 };
  }
  async ask(req: { text: string; language: 'en' | 'th' | 'auto'; snapshot?: unknown; userId: string }, signal?: AbortSignal): Promise<AskResponse> {
    this.asks.push(req);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const reply = this.askOverride ? this.askOverride(req.text) : await this.mock.ask(req as never);
    return { reply, ...planSpeech(reply, req.language, req.text), assistantMs: 120 };
  }
  async tts(req: { text: string; language: Lang; speed: number }, signal: AbortSignal): Promise<TtsResponse> {
    this.ttsRequests.push(req);
    if (this.ttsFails) throw new Error('network down');
    if (this.ttsDelayMs) await new Promise((r) => setTimeout(r, this.ttsDelayMs));
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const body = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new Uint8Array(4800)); c.enqueue(new Uint8Array(4800)); c.close(); },
    });
    return { sampleRate: 24000, cache: 'miss', ttfbMs: 90, model: 'fake', body };
  }
  reportUsage(s: number) { this.usageReports.push(s); }
  logFriction(e: unknown) { this.friction.push(e); }
  reportMetrics(m: TurnMetrics) { this.metrics.push(m); }
}

/** Let promises settle. */
export const flush = async (times = 6) => { for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r)); };
