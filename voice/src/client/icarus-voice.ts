// IcarusVoice: the one class the frontend uses.
//
//   const voice = new IcarusVoice({ serverUrl: 'http://localhost:8787' });
//   voice.on('finalTranscript', (t) => ...);
//   await voice.start();            // call from a click: browsers need a gesture for mic + audio
//   voice.setSnapshot(snapshot);    // the latest screen snapshot, passed to the assistant on every question
//
// How a turn flows:
//   mic -> Scribe (partial + final transcripts) -> noise filter -> local commands?
//       -> assistant (via our server) -> speech text -> TTS stream -> speaker
// Money previews take a detour through ConfirmFlow (read-back, then confirm or cancel).
//
// This class decides WHEN things happen. It never executes a trade. See confirm-flow.ts.

import { DEFAULTS, type VoiceDefaults } from '../config/defaults';
import { STRINGS } from '../config/strings';
import { GLOBAL_COMMANDS, matchCommand } from '../shared/commands';
import { detectLang } from '../shared/lang';
import { toSpeakable } from '../shared/speech-format';
import { isEchoOf, shouldAcceptFinal } from '../shared/transcript';
import type {
  AskResponse,
  FinalTranscript,
  Lang,
  LangSetting,
  LocalCommand,
  Mode,
  Snapshot,
  TurnMetrics,
  UsageTotals,
  VoiceEvents,
  VoiceState,
} from '../shared/types';
import { VoiceApi, VoiceApiError, type VoiceApiPort } from './api';
import { ConfirmFlow, type TimerPort } from './confirm-flow';
import { Emitter } from './emitter';
import { browserSpeechFallback, type FallbackSpeaker } from './fallback-voice';
import type { MicFrame, MicPort } from './mic';
import { WebMic } from './mic';
import { WebAudioOutput, type AudioOutput, type PlaybackHandle } from './player';
import { VoiceStateMachine } from './state-machine';
import { SttClient, type SttFinal, type SttPort } from './stt-client';
import { EnergyVad } from './vad';

// ---------------------------------------------------------------------------
// Options and dependencies
// ---------------------------------------------------------------------------

type DeepPartial<T> = { [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface IcarusVoiceOptions {
  /** Where the voice server runs. Default: same origin. */
  serverUrl?: string;
  userId?: string;
  language?: LangSetting;
  mode?: Mode;
  /** Override any number in config/defaults.ts. */
  config?: DeepPartial<VoiceDefaults>;
  /** TESTING ONLY. Lets the test page's simulated speech start a confirm countdown. Never enable in the real app. */
  acceptSimulatedConfirm?: boolean;
  /** Use the browser's own voice if ElevenLabs fails. Default true. */
  fallbackToBrowserVoice?: boolean;
  /** Replace the microphone (the test page uses a synthetic one). */
  mic?: MicPort;
  /** Replace the browser, network and audio pieces. For tests. */
  deps?: Partial<IcarusVoiceDeps>;
}

export interface AudioDeps {
  /**
   * Create or resume the audio system. Must be called from a user gesture the first time.
   * Returns the state ('running' means sound can play). undefined means "unknown" (tests).
   */
  unlock(): Promise<AudioContextState | undefined>;
  output(): AudioOutput;
  mic: MicPort;
}

export interface IcarusVoiceDeps {
  api: VoiceApiPort;
  audio: AudioDeps;
  createStt: () => SttPort;
  timers: TimerPort;
  speakFallback: FallbackSpeaker | null;
}

function createBrowserDeps(serverUrl: string, sessionId: string, startLeadMs: number, mic?: MicPort): IcarusVoiceDeps {
  let ctx: AudioContext | null = null;
  let output: WebAudioOutput | null = null;
  const getContext = () => (ctx ??= new AudioContext({ latencyHint: 'interactive' }));
  return {
    api: new VoiceApi(serverUrl, sessionId),
    audio: {
      async unlock() {
        const c = getContext();
        // If the browser blocks audio, resume() can stay pending forever. Do not wait for it.
        if (c.state === 'suspended') await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 1500))]);
        return c.state;
      },
      output: () => (output ??= new WebAudioOutput(getContext(), startLeadMs)),
      mic: mic ?? new WebMic(getContext),
    },
    createStt: () => new SttClient(),
    timers: {
      now: () => performance.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    },
    speakFallback: browserSpeechFallback,
  };
}

function mergeConfig(base: VoiceDefaults, over: DeepPartial<VoiceDefaults> | undefined): VoiceDefaults {
  const out = structuredClone(base) as Record<string, unknown>;
  const walk = (target: Record<string, unknown>, source: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue;
      const current = target[key];
      if (value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object') {
        walk(current as Record<string, unknown>, value as Record<string, unknown>);
      } else target[key] = value;
    }
  };
  if (over) walk(out, over as Record<string, unknown>);
  return out as VoiceDefaults;
}

// ---------------------------------------------------------------------------
// The controller
// ---------------------------------------------------------------------------

interface ActivePlayback {
  text: string;
  lang: Lang;
  kind: 'reply' | 'readback' | 'line';
  /** True only for the money read-back. Only this one can unlock "confirm". */
  isReadback: boolean;
  turnId: number | null;
  abort: AbortController;
  handle: PlaybackHandle | null;
  started: boolean;
  ended: boolean;
}

const PRE_ROLL_FRAMES = 15; // 300 ms of audio kept for push-to-talk
const BACKGROUND_TICK_MS = 5000;
const PTT_FINAL_TIMEOUT_MS = 5000;
const PTT_KEEP_OPEN_MS = 8000;

export class IcarusVoice extends Emitter<VoiceEvents> {
  private readonly cfg: VoiceDefaults;
  private readonly deps: IcarusVoiceDeps;
  private readonly sm: VoiceStateMachine;
  private readonly vad: EnergyVad;
  private readonly confirm: ConfirmFlow;
  private readonly userId: string;
  private readonly fallbackEnabled: boolean;

  private running = false;
  private mode: Mode;
  private language: LangSetting;
  /** Language of the conversation so far. Fixed lines use it. */
  private currentLang: Lang;
  private snapshot: Snapshot | undefined;

  private stt: SttPort | null = null;
  private sttSecondsBase = 0;
  private reconnectAttempts = 0;
  private reconnectTimer: unknown = null;

  private preRoll: Int16Array[] = [];
  private pttQueue: Int16Array[] = [];
  private pttActive = false;
  private pttWaiting = false;
  private pttCommitWhenOpen = false;
  private pttTimers: unknown[] = [];

  private playback: ActivePlayback | null = null;
  private lastSpoken: { text: string; lang: Lang } | null = null;
  private lastSpeech: { text: string; endedAt: number | null } | null = null;
  private pendingReadback: { text: string; lang: Lang } | null = null;

  private turnId = 0;
  private turnAbort: AbortController | null = null;
  private timing: { turnId: number; finalAt: number; speechEndAt: number; fromMic: boolean; assistantMs: number | null; ttsFirstByteMs: number | null; cache: 'hit' | 'miss' | null; sent: boolean } | null = null;

  private utterance: { startedAt: number | null; firstPartialAt: number | null } = { startedAt: null, firstPartialAt: null };
  private bargeLoudSince: number | null = null;
  private volumeStep = 0;
  private speedStep = 0;
  private lastActivityAt = 0;
  private tickHandle: unknown = null;
  private tickCount = 0;
  private usage: UsageTotals = { sttSeconds: 0, ttsCharacters: 0, ttsCharactersFromCache: 0 };

  constructor(options: IcarusVoiceOptions = {}) {
    super();
    this.cfg = mergeConfig(DEFAULTS, options.config);
    this.mode = options.mode ?? 'hands-free';
    this.language = options.language ?? 'en';
    this.currentLang = this.language === 'th' ? 'th' : 'en';
    this.userId = options.userId ?? 'demo-user';
    this.fallbackEnabled = options.fallbackToBrowserVoice ?? true;

    const sessionId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
    // Real browser pieces, with anything the caller provides (tests) swapped in. Nothing here touches the DOM until it is used.
    this.deps = { ...createBrowserDeps(options.serverUrl ?? '', sessionId, this.cfg.tts.startLeadMs, options.mic), ...options.deps };

    this.sm = new VoiceStateMachine(
      (change) => this.emit('stateChange', change),
      (from, to, reason) => console.warn(`[icarus-voice] ignored illegal state change ${from} -> ${to} (${reason})`),
    );

    this.vad = new EnergyVad({
      hangoverMs: this.cfg.vad.hangoverMs,
      onsetMs: this.cfg.bargeIn.onsetMs,
      minRms: this.cfg.bargeIn.minRms,
      ratio: this.cfg.bargeIn.energyRatio,
      ratioWhileSpeaking: this.cfg.bargeIn.energyRatioWhileSpeaking,
    });

    this.confirm = new ConfirmFlow(
      {
        minConfidence: this.cfg.confirm.minConfidence,
        countdownMs: this.cfg.confirm.countdownMs,
        awaitTimeoutMs: this.cfg.confirm.awaitTimeoutMs,
        requiresTap: this.cfg.confirm.requiresTap,
        acceptedSources: options.acceptSimulatedConfirm ? ['voice', 'simulated'] : ['voice'],
      },
      this.deps.timers,
      {
        onPhase: (phase, reason) => this.onConfirmPhase(phase, reason),
        onCountdown: (e) => this.emit('countdown', e),
        onIntent: (e) => this.emit('confirmIntent', e),
        onCancelled: ({ by }) => {
          // Say it out loud only when the user cancelled by voice. A tap has its own feedback.
          if (by === 'voice') this.speakLine(STRINGS[this.currentLang].lines.cancelled);
        },
        onExpired: () => undefined,
      },
    );
  }

  // =========================================================================
  // Public API
  // =========================================================================

  get state(): VoiceState {
    return this.sm.state;
  }

  /** Call from a click or tap. Browsers only allow audio after a gesture. Safe to call many times. */
  async unlock(): Promise<void> {
    await this.ensureAudio();
  }

  private audioWarned = false;

  /** Unlock audio. If the browser still blocks sound, say so once, instead of failing silently. */
  private async ensureAudio(): Promise<void> {
    const state = await this.deps.audio.unlock();
    if (state !== undefined && state !== 'running' && !this.audioWarned) {
      this.audioWarned = true;
      this.emit('error', {
        code: 'audio_blocked',
        message:
          'The browser is blocking sound, so you will hear nothing. Click once on the page and try again. ' +
          'In Brave, open the lion (Shields) icon and the site settings, and allow Sound for this site.',
        fatal: false,
      });
    }
  }

  /** Turn the microphone on. In hands-free mode it stays on until stop(). */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.lastActivityAt = this.deps.timers.now();
    try {
      await this.ensureAudio();
      await this.deps.audio.mic.start((frame) => this.onMicFrame(frame));
    } catch (err) {
      this.running = false;
      this.fail('mic_denied', `Could not use the microphone: ${(err as Error).message}`);
      return;
    }
    this.scheduleTick();
    if (this.mode === 'hands-free') {
      this.setState('listening', 'start');
      try {
        await this.connectStt();
      } catch (err) {
        this.fail('stt_unavailable', describe(err));
        this.stop('stt_unavailable');
      }
    } else {
      this.setState('idle', 'start');
      void this.connectStt().catch(() => undefined); // warm up. If it fails we retry when the button is pressed.
    }
  }

  /** Turn everything off: mic, speech-to-text, playback, any pending voice confirmation. */
  stop(reason = 'stop'): void {
    const wasRunning = this.running;
    this.running = false;
    this.cancelTurn();
    this.stopPlayback('stopped');
    if (this.confirm.phase) this.confirm.cancel('stopped');
    this.pendingReadback = null;
    this.clearPttTimers();
    this.pttActive = false;
    this.pttWaiting = false;
    this.pttQueue = [];
    this.cancelReconnect();
    this.closeStt();
    if (wasRunning) {
      this.deps.audio.mic.stop();
      this.reportUsage(true);
    }
    if (this.tickHandle !== null) this.deps.timers.clearTimeout(this.tickHandle);
    this.tickHandle = null;
    this.setState('idle', reason);
  }

  /** 'hands-free': mic stays on. 'push-to-talk': the user holds a button (see pushToTalkStart). */
  setMode(mode: Mode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (!this.running) return;
    this.clearPttTimers();
    this.pttActive = false;
    this.restartStt();
    if (!this.confirm.phase && !this.playback) this.setState(mode === 'hands-free' ? 'listening' : 'idle', 'mode_change');
  }

  /** 'en', 'th', or 'auto' (Scribe detects the language each time). */
  setLanguage(language: LangSetting): void {
    if (language === this.language) return;
    this.language = language;
    if (language !== 'auto') this.currentLang = language;
    if (this.running) this.restartStt();
  }

  /** Give us the latest screen snapshot. We pass it to the assistant with every question and never read it. */
  setSnapshot(snapshot: Snapshot | undefined): void {
    this.snapshot = snapshot;
  }

  /** Push-to-talk: call when the button goes down. */
  pushToTalkStart(): void {
    if (!this.running || this.mode !== 'push-to-talk' || this.pttActive) return;
    if (this.playback && !this.playback.ended) this.bargeIn('push-to-talk');
    this.clearPttTimers();
    this.pttActive = true;
    this.lastActivityAt = this.deps.timers.now();
    this.utterance.startedAt = this.deps.timers.now();
    if (!this.confirm.phase) this.setState('listening', 'push_to_talk');
    this.pttQueue = [...this.preRoll]; // include the moment just before the press
    this.preRoll = [];
    if (this.stt?.isOpen) this.drainPttQueue();
    else {
      void this.connectStt()
        .then(() => {
          this.drainPttQueue();
          if (this.pttCommitWhenOpen) this.finishPtt();
        })
        .catch((err) => {
          this.fail('stt_unavailable', describe(err));
          this.pttActive = false;
          this.afterSpeech();
        });
    }
  }

  /** Push-to-talk: call when the button comes up. */
  pushToTalkEnd(): void {
    if (!this.running || this.mode !== 'push-to-talk' || !this.pttActive) return;
    this.pttActive = false;
    if (this.stt?.isOpen) this.finishPtt();
    else this.pttCommitWhenOpen = true; // still connecting. Commit as soon as it is open.
  }

  /** Send typed text through the same pipeline as speech. */
  sendText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.lastActivityAt = this.deps.timers.now();
    const language = this.resolveLanguage(trimmed, null);
    this.currentLang = language;
    this.handleUtterance({ text: trimmed, confidence: null, language, source: 'text', speechStartedAt: null });
  }

  /**
   * Say a line out loud (for example "Confirmed. Your gold purchase is on its way." after the
   * UI has executed a trade). Markdown and symbols are cleaned up, but numbers are kept EXACT:
   * a line the UI passes in is already final text, so we never round it.
   */
  speak(text: string, options: { language?: Lang } = {}): void {
    const lang = options.language ?? detectLang(text, this.currentLang);
    const spoken = toSpeakable(text, { lang, shorten: false, exact: true });
    if (!spoken) return;
    this.lastActivityAt = this.deps.timers.now();
    void this.playSpeech({ text: spoken, language: lang, kind: 'line' }, null);
  }

  /** The user tapped Cancel on the preview or the countdown. */
  cancelConfirm(): void {
    this.confirm.cancel('tap');
  }

  /** The UI dealt with the preview (executed it, or cancelled it by tap). Ends the voice side quietly. */
  confirmResolved(): void {
    this.confirm.resolved();
    this.pendingReadback = null;
  }

  /**
   * TEST PAGE ONLY: act as if Scribe heard this. It goes through the same filter, commands and
   * confirm rules as real speech. It can only start a countdown if acceptSimulatedConfirm is on.
   */
  injectTranscript(text: string, confidence: number | null = 0.95): void {
    const now = this.deps.timers.now();
    const language = this.resolveLanguage(text, null);
    this.processFinal({ text: text.trim(), confidence, language, source: 'simulated', speechStartedAt: now }, false);
  }

  get usageTotals(): UsageTotals {
    return { ...this.usage, sttSeconds: this.currentSttSeconds() };
  }

  // =========================================================================
  // Speech-to-text
  // =========================================================================

  private async connectStt(): Promise<void> {
    const token = await this.deps.api.scribeToken(this.language, this.mode);
    const stt = this.deps.createStt();
    stt.on('partial', (text) => this.onSttPartial(stt, text));
    stt.on('final', (f) => this.onSttFinal(stt, f));
    stt.on('error', (e) => this.onSttError(stt, e));
    stt.on('close', (info) => this.onSttClose(stt, info.requested));
    await stt.connect(token.url);
    if (!this.running) {
      stt.close();
      return;
    }
    this.stt = stt;
    this.reconnectAttempts = 0;
  }

  private closeStt(): void {
    if (!this.stt) return;
    const stt = this.stt;
    this.stt = null;
    this.sttSecondsBase += stt.secondsSent;
    stt.close();
  }

  /** Language or mode changed: new session with the new settings. */
  private restartStt(): void {
    this.closeStt();
    if (this.mode === 'hands-free') {
      void this.connectStt().catch((err) => {
        this.fail('stt_unavailable', describe(err));
        this.stop('stt_unavailable');
      });
    }
  }

  private onSttClose(stt: SttPort, requested: boolean): void {
    if (this.stt !== stt) return; // an old connection we already replaced
    this.stt = null;
    this.sttSecondsBase += stt.secondsSent;
    if (!this.running || requested || this.mode !== 'hands-free') return;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= 3) {
      this.fail('stt_disconnected', 'Lost the connection to speech-to-text and could not get it back.');
      this.stop('stt_disconnected');
      return;
    }
    const delay = 500 * 2 ** this.reconnectAttempts++;
    this.reconnectTimer = this.deps.timers.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.running) return;
      this.connectStt().catch(() => this.scheduleReconnect());
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) this.deps.timers.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
  }

  private onSttError(stt: SttPort, e: { code: string; message: string }): void {
    if (this.stt !== stt && this.stt !== null) return;
    const fatal = ['auth_error', 'quota_exceeded', 'unaccepted_terms'].includes(e.code);
    this.emit('error', { code: e.code, message: e.message, fatal });
    if (fatal) this.stop(e.code);
  }

  // =========================================================================
  // Microphone and local voice activity
  // =========================================================================

  private onMicFrame(frame: MicFrame): void {
    const now = this.deps.timers.now();
    const audible = this.isAudible();
    const event = this.vad.push(frame.rms, now, audible);
    if (event === 'speech_start') {
      this.utterance.startedAt = this.vad.speechStartedAt;
      this.lastActivityAt = now;
    } else if (event === 'speech_end' && this.utterance.firstPartialAt === null) {
      // Loud, but Scribe heard no words (a cough, a door). Forget when it "started".
      this.utterance.startedAt = null;
    }

    // Hybrid barge-in: loud enough, long enough, and much louder than Icarus's own echo.
    // This watches loudness by itself, so it still works if the user was already mid-sentence.
    if (audible && this.cfg.bargeIn.mode === 'hybrid') this.checkLoudBargeIn(frame.rms, now);
    else this.bargeLoudSince = null;

    if (this.mode === 'hands-free') {
      this.stt?.sendAudio(frame.pcm);
    } else if (this.pttActive) {
      if (this.stt?.isOpen) this.stt.sendAudio(frame.pcm);
      else this.pttQueue.push(frame.pcm);
    } else {
      this.preRoll.push(frame.pcm);
      if (this.preRoll.length > PRE_ROLL_FRAMES) this.preRoll.shift();
    }
  }

  private checkLoudBargeIn(rms: number, now: number): void {
    if (rms <= this.vad.threshold(true)) {
      this.bargeLoudSince = null;
      return;
    }
    this.bargeLoudSince ??= now;
    if (now - this.bargeLoudSince >= this.cfg.bargeIn.onsetMs) {
      this.utterance.startedAt = this.bargeLoudSince; // when this interruption began
      this.bargeLoudSince = null;
      this.lastActivityAt = now;
      this.bargeIn('energy');
    }
  }

  private drainPttQueue(): void {
    const queue = this.pttQueue;
    this.pttQueue = [];
    for (const frame of queue) this.stt?.sendAudio(frame);
  }

  private finishPtt(): void {
    this.pttCommitWhenOpen = false;
    this.drainPttQueue();
    this.stt?.commit();
    this.pttWaiting = true;
    if (!this.confirm.phase) this.setState('thinking', 'push_to_talk_released');
    // If Scribe returns nothing we go back to idle instead of waiting forever.
    this.pttTimers.push(
      this.deps.timers.setTimeout(() => {
        if (this.pttWaiting) {
          this.pttWaiting = false;
          this.afterSpeech();
        }
      }, PTT_FINAL_TIMEOUT_MS),
      // Scribe closes sockets that go quiet. Close ours before that and reopen on the next press.
      this.deps.timers.setTimeout(() => {
        if (!this.pttActive) this.closeStt();
      }, PTT_KEEP_OPEN_MS),
    );
  }

  private clearPttTimers(): void {
    for (const h of this.pttTimers) this.deps.timers.clearTimeout(h);
    this.pttTimers = [];
  }

  // =========================================================================
  // Transcripts
  // =========================================================================

  private onSttPartial(stt: SttPort, text: string): void {
    if (this.stt !== stt) return;
    const now = this.deps.timers.now();
    this.lastActivityAt = now;
    if (this.utterance.firstPartialAt === null) this.utterance.firstPartialAt = now;
    this.emit('partialTranscript', { text });

    // Barge-in by transcript: Scribe heard words while Icarus is talking, and they are not Icarus's own voice.
    if (this.isAudible() && text.trim().length >= this.cfg.bargeIn.minPartialChars && !this.isEcho(text)) {
      this.bargeIn('transcript');
    }
  }

  private onSttFinal(stt: SttPort, f: SttFinal): void {
    if (this.stt !== stt) return;
    this.lastActivityAt = this.deps.timers.now();
    const language = this.resolveLanguage(f.text, f.languageCode);
    const speechStartedAt = this.utterance.startedAt ?? this.utterance.firstPartialAt;
    this.utterance = { startedAt: null, firstPartialAt: null };
    this.processFinal({ text: f.text, confidence: f.confidence, language, source: 'voice', speechStartedAt }, true);
  }

  /** Filter, announce, log, then act. */
  private processFinal(final: FinalTranscript, checkEcho: boolean): void {
    const wasWaiting = this.pttWaiting;
    this.pttWaiting = false;

    if (checkEcho && this.isEcho(final.text)) {
      this.emit('transcriptIgnored', { text: final.text, reason: 'echo', confidence: final.confidence });
      if (wasWaiting) this.afterSpeech();
      return;
    }
    const isCommand = matchCommand(final.text, [...GLOBAL_COMMANDS, 'confirm', 'cancel']) !== null;
    const verdict = shouldAcceptFinal({ text: final.text, confidence: final.confidence }, this.cfg.filter, isCommand);
    if (!verdict.accept) {
      this.emit('transcriptIgnored', { text: final.text, reason: verdict.reason, confidence: final.confidence });
      if (wasWaiting) this.afterSpeech();
      return;
    }

    this.currentLang = final.language;
    this.emit('finalTranscript', final);
    this.deps.api.logFriction({
      type: 'voice_final',
      screen: typeof this.snapshot?.screen === 'string' ? this.snapshot.screen : null,
      text: final.text,
      language: final.language,
      confidence: final.confidence,
      userId: this.userId,
      source: final.source,
    });
    this.handleUtterance(final);
  }

  private resolveLanguage(text: string, code: string | null): Lang {
    if (this.language !== 'auto') return this.language;
    if (code && /^th/i.test(code)) return 'th';
    if (code && /^en/i.test(code)) return 'en';
    return detectLang(text, this.currentLang);
  }

  /** Is this text just Icarus's own voice coming back through the mic? */
  private isEcho(text: string): boolean {
    const speech = this.lastSpeech;
    if (!speech) return false;
    const recent = this.playback !== null || (speech.endedAt !== null && this.deps.timers.now() - speech.endedAt < 2000);
    return recent && isEchoOf(text, speech.text, this.cfg.bargeIn.echoMinChars);
  }

  // =========================================================================
  // What to do with an utterance
  // =========================================================================

  private handleUtterance(final: FinalTranscript): void {
    // Anything the user says while Icarus is talking stops Icarus first.
    if (this.isAudible()) this.bargeIn(final.source === 'voice' ? 'final' : null);

    // 1. A money preview is waiting for an answer.
    if (this.confirm.phase) {
      switch (this.confirm.handleUtterance(final)) {
        case 'cancelled':
        case 'confirmed':
        case 'ignored':
          return;
        case 'repeat':
        case 'too_early': // "confirm" before the read-back ended is not accepted. Start the read-back over.
          this.repeatReadback();
          return;
        case 'unclear':
          this.speakLine(STRINGS[this.currentLang].lines.didntCatch);
          return;
        case 'passthrough':
          break; // the user moved on. Treat it as a normal question.
      }
    }

    // 2. Commands we handle ourselves, without the assistant.
    const command = matchCommand(final.text, GLOBAL_COMMANDS);
    if (command) {
      this.runCommand(command as LocalCommand, final.text);
      return;
    }

    // 3. Ask the assistant.
    void this.runTurn(final);
  }

  private runCommand(name: LocalCommand, text: string): void {
    this.emit('command', { name, text });
    const lines = STRINGS[this.currentLang].lines;
    switch (name) {
      case 'stop':
        this.cancelTurn();
        this.stopPlayback('stopped');
        this.afterSpeech();
        break;
      case 'repeat':
        if (this.lastSpoken) void this.playSpeech({ text: this.lastSpoken.text, language: this.lastSpoken.lang, kind: 'line' }, null);
        else this.speakLine(lines.nothingToRepeat);
        break;
      case 'back':
        // The UI does the navigating. It listens for the 'command' event.
        this.speakLine(lines.goingBack);
        break;
      case 'louder':
        this.volumeStep = Math.min(this.volumeStep + 1, this.cfg.tts.volumeSteps.length - 1);
        this.deps.audio.output().setVolume(this.cfg.tts.volumeSteps[this.volumeStep] ?? 1);
        this.speakLine(lines.louder);
        break;
      case 'slower':
        this.speedStep = Math.min(this.speedStep + 1, this.cfg.tts.speedSteps.length - 1);
        this.speakLine(lines.slower);
        break;
    }
  }

  // =========================================================================
  // The assistant turn
  // =========================================================================

  private async runTurn(final: FinalTranscript): Promise<void> {
    this.cancelTurn();
    const turnId = ++this.turnId;
    const abort = new AbortController();
    this.turnAbort = abort;
    const now = this.deps.timers.now();
    const fromMic = final.source === 'voice' && this.vad.lastLoudAt !== null;
    this.timing = { turnId, finalAt: now, speechEndAt: fromMic ? (this.vad.lastLoudAt as number) : now, fromMic, assistantMs: null, ttsFirstByteMs: null, cache: null, sent: false };
    this.setState('thinking', 'final_transcript');

    let response: AskResponse;
    try {
      response = await this.deps.api.ask(
        { text: final.text, language: final.language, ...(this.snapshot ? { snapshot: this.snapshot } : {}), userId: this.userId },
        abort.signal,
      );
    } catch (err) {
      if (abort.signal.aborted || turnId !== this.turnId) return;
      this.emit('error', { code: err instanceof VoiceApiError ? err.code : 'assistant_failed', message: describe(err), fatal: false });
      this.afterSpeech();
      return;
    }
    if (turnId !== this.turnId) return; // the user said something newer
    if (this.timing) this.timing.assistantMs = response.assistantMs;
    this.emit('assistantReply', response);

    if (!response.speech) {
      this.sendMetrics(null);
      this.afterSpeech();
      return;
    }

    // A money preview: read it back exactly, then wait for confirm or cancel.
    if (response.preview && response.speech.kind === 'readback' && this.running) {
      this.pendingReadback = { text: response.speech.text, lang: response.speech.language };
      this.confirm.begin(response.preview);
      this.confirm.readbackStarted();
    }
    void this.playSpeech(response.speech, turnId);
  }

  private cancelTurn(): void {
    this.turnAbort?.abort();
    this.turnAbort = null;
    this.turnId += 1; // any answer still on its way is now out of date
  }

  // =========================================================================
  // Speaking
  // =========================================================================

  /** Short fixed line (cached on the server after the first time). */
  private speakLine(text: string): void {
    void this.playSpeech({ text, language: this.currentLang, kind: 'line' }, null);
  }

  private repeatReadback(): void {
    const readback = this.pendingReadback;
    if (!readback) return;
    this.confirm.readbackStarted(); // blocks "confirm" again until this finishes
    void this.playSpeech({ text: readback.text, language: readback.lang, kind: 'readback' }, null);
  }

  private async playSpeech(speech: { text: string; language: Lang; kind: 'reply' | 'readback' | 'line' }, turnId: number | null): Promise<void> {
    this.stopPlayback('stopped');
    const pb: ActivePlayback = {
      text: speech.text,
      lang: speech.language,
      kind: speech.kind,
      isReadback: speech.kind === 'readback',
      turnId,
      abort: new AbortController(),
      handle: null,
      started: false,
      ended: false,
    };
    this.playback = pb;
    this.lastSpeech = { text: speech.text, endedAt: null };
    this.lastSpoken = { text: speech.text, lang: speech.language };
    this.lastActivityAt = this.deps.timers.now();

    try {
      await this.ensureAudio();
      const res = await this.deps.api.tts({ text: speech.text, language: speech.language, speed: this.cfg.tts.speedSteps[this.speedStep] ?? 1 }, pb.abort.signal);
      if (pb.ended) {
        void res.body.cancel().catch(() => undefined);
        return;
      }
      if (this.timing && turnId === this.timing.turnId) {
        this.timing.ttsFirstByteMs = res.ttfbMs;
        this.timing.cache = res.cache;
      }
      if (res.cache === 'hit') this.usage.ttsCharactersFromCache += speech.text.length;
      else this.usage.ttsCharacters += speech.text.length;
      this.emitUsage();

      const handle = this.deps.audio.output().begin(res.sampleRate, () => this.onFirstAudio(pb));
      pb.handle = handle;
      void this.pump(res.body, pb);
      const result = await handle.finished;
      this.onPlaybackDone(pb, result);
    } catch (err) {
      if (pb.ended) return;
      this.onTtsFailed(pb, err);
    }
  }

  /** Move audio from the network to the speaker. */
  private async pump(body: ReadableStream<Uint8Array>, pb: ActivePlayback): Promise<void> {
    const reader = body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (pb.ended) {
          void reader.cancel().catch(() => undefined);
          return;
        }
        if (done) break;
        pb.handle?.push(value);
      }
      pb.handle?.end();
    } catch (err) {
      if (pb.ended) return;
      pb.handle?.stop(); // never let half a read-back count as a finished one
      this.onTtsFailed(pb, err);
    }
  }

  private onFirstAudio(pb: ActivePlayback): void {
    if (this.playback !== pb || pb.ended || pb.started) return;
    pb.started = true;
    this.lastActivityAt = this.deps.timers.now();
    if (!this.confirm.phase) this.setState('speaking', 'first_audio');
    this.emit('speakingStart', { text: pb.text, kind: pb.kind });
    if (pb.turnId !== null) this.sendMetrics(this.deps.timers.now());
  }

  private onPlaybackDone(pb: ActivePlayback, result: 'finished' | 'stopped'): void {
    if (this.playback !== pb || pb.ended || result !== 'finished') return;
    pb.ended = true;
    this.playback = null;
    if (this.lastSpeech) this.lastSpeech.endedAt = this.deps.timers.now();
    this.lastActivityAt = this.deps.timers.now();
    if (pb.started) this.emit('speakingEnd', { reason: 'finished' });
    // The ONLY place that unlocks "confirm": the read-back audio ended on its own.
    if (pb.isReadback) this.confirm.readbackFinished();
    this.afterSpeech();
  }

  private onTtsFailed(pb: ActivePlayback, err: unknown): void {
    this.emit('error', { code: 'tts_failed', message: `Voice failed: ${describe(err)}`, fatal: false });
    if (this.fallbackEnabled && this.deps.speakFallback) {
      const handle = this.deps.speakFallback(
        pb.text,
        pb.lang,
        this.cfg.tts.volumeSteps[this.volumeStep] ?? 1,
        this.cfg.tts.speedSteps[this.speedStep] ?? 1,
        () => this.onFirstAudio(pb),
      );
      if (handle) {
        pb.handle = handle;
        void handle.finished.then((r) => this.onPlaybackDone(pb, r));
        return;
      }
    }
    // No sound at all.
    pb.ended = true;
    if (this.playback === pb) this.playback = null;
    if (pb.isReadback && this.confirm.phase) {
      // We could not read the preview aloud, so voice confirmation is off. The card on screen still works.
      this.confirm.resolved();
      this.pendingReadback = null;
      this.emit('error', { code: 'readback_failed', message: 'Could not read the preview aloud. Use the card on screen.', fatal: false });
    }
    this.afterSpeech();
  }

  private isAudible(): boolean {
    return this.playback !== null && !this.playback.ended;
  }

  private stopPlayback(reason: 'interrupted' | 'stopped'): void {
    const pb = this.playback;
    if (!pb) return;
    this.playback = null;
    pb.ended = true;
    if (this.lastSpeech) this.lastSpeech.endedAt = this.deps.timers.now();
    pb.abort.abort();
    pb.handle?.stop();
    if (pb.started) this.emit('speakingEnd', { reason });
  }

  /** The user talked over Icarus. Stop at once and listen. */
  private bargeIn(source: VoiceEvents['bargeIn']['source'] | null): void {
    if (!this.isAudible()) return;
    const now = this.deps.timers.now();
    // Measure from the first loud mic frame. A transcript can arrive before the loudness check is sure.
    const startedAt = this.bargeLoudSince ?? this.utterance.startedAt ?? this.utterance.firstPartialAt;
    this.bargeLoudSince = null;
    this.stopPlayback('interrupted'); // a stopped read-back never unlocks "confirm"
    if (source) this.emit('bargeIn', { source, ms: startedAt === null ? null : Math.round(now - startedAt) });
    if (!this.confirm.phase) this.setState('listening', 'barge_in');
  }

  // =========================================================================
  // State, confirm hooks, timers
  // =========================================================================

  private setState(to: VoiceState, reason: string, phase: 'readback' | 'awaiting' | 'countdown' | null = null): void {
    this.sm.to(to, reason, phase);
  }

  /** Where we go when there is nothing left to say. */
  private afterSpeech(): void {
    if (this.confirm.phase) return; // still waiting on a confirmation
    const listening = this.running && (this.mode === 'hands-free' || this.pttActive);
    this.setState(listening ? 'listening' : 'idle', 'speech_finished');
  }

  private onConfirmPhase(phase: 'readback' | 'awaiting' | 'countdown' | null, reason: string): void {
    if (phase === null) {
      if (this.sm.state === 'confirming') {
        const listening = this.running && (this.mode === 'hands-free' || this.pttActive);
        this.setState(this.playback ? 'speaking' : listening ? 'listening' : 'idle', reason);
      }
      return;
    }
    if (this.sm.state !== 'confirming') this.setState('confirming', reason, phase);
    else this.sm.setPhase(phase, reason);
  }

  private sendMetrics(firstAudioAt: number | null): void {
    const t = this.timing;
    if (!t || t.sent) return;
    t.sent = true;
    const metrics: TurnMetrics = {
      turnId: t.turnId,
      sttFinalMs: t.fromMic ? Math.round(t.finalAt - t.speechEndAt) : null,
      assistantMs: t.assistantMs,
      ttsFirstByteMs: t.ttsFirstByteMs,
      timeToFirstAudioMs: firstAudioAt === null ? null : Math.round(firstAudioAt - t.speechEndAt),
      ttsCache: t.cache,
    };
    this.emit('turnMetrics', metrics);
    this.deps.api.reportMetrics(metrics);
  }

  private fail(code: string, message: string): void {
    this.emit('error', { code, message, fatal: true });
  }

  // ---- background work: idle protection and usage ----

  private scheduleTick(): void {
    this.tickHandle = this.deps.timers.setTimeout(() => {
      this.tick();
      if (this.running) this.scheduleTick();
    }, BACKGROUND_TICK_MS);
  }

  private tick(): void {
    const idleStop = this.cfg.idleStopAfterSec;
    const idleMs = this.deps.timers.now() - this.lastActivityAt;
    if (idleStop > 0 && this.mode === 'hands-free' && this.sm.state === 'listening' && idleMs > idleStop * 1000) {
      this.emit('error', { code: 'idle_timeout', message: `Microphone turned off after ${idleStop} seconds of quiet, to save credits.`, fatal: false });
      this.stop('idle_timeout');
      return;
    }
    this.tickCount += 1;
    if (this.tickCount % 2 === 0) this.reportUsage(false);
  }

  private currentSttSeconds(): number {
    return this.sttSecondsBase + (this.stt?.secondsSent ?? 0);
  }

  private emitUsage(): void {
    this.emit('usage', this.usageTotals);
  }

  private reportUsage(final: boolean): void {
    const seconds = this.currentSttSeconds();
    if (seconds > 0 || final) this.deps.api.reportUsage(seconds);
    this.emitUsage();
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
