// Connects the prototype to the Icarus voice stack.
//
// The prototype already has hooks for an external voice, so we do NOT change it:
//   - Icarus.setTTS(fn, stop)  : it asks us to speak a line. We use ElevenLabs text-to-speech
//                                (English on Flash v2.5, Thai on v4 Turbo), with the browser voice as a fallback.
//   - window.SpeechRecognition : it listens with the browser's speech recognition (which does not work in Brave).
//                                We replace it with a look-alike backed by ElevenLabs Scribe, so the prototype's
//                                own listening code runs unchanged.
//
// The voice module runs in `assistant: 'external'` mode: it listens and speaks, the prototype does the thinking.

import { IcarusVoice } from '../../voice/src/client';
import { GLOBAL_COMMANDS, matchCommand } from '../../voice/src/shared/commands';

export interface VoiceBridgeOptions {
  /** Where the voice server runs. Default: the same origin as this page. */
  serverUrl?: string;
  /** Gives the bridge the prototype's component, for the "go back" voice command. */
  getComponent?: () => { goBack?: () => void } | null;
  /** Called with a short status the page can show. */
  onStatus?: (status: { kind: 'info' | 'error'; text: string }) => void;
}

/** How long we keep the mic open after the prototype stops listening, so barge-in still works while Icarus talks. */
const MIC_LINGER_MS = 20_000;

interface RecognitionResult extends Array<{ transcript: string }> {
  isFinal: boolean;
}

/** The part of IcarusVoice the bridge uses. Tests pass a fake. */
export type VoiceLike = Pick<IcarusVoice, 'on' | 'start' | 'stop' | 'setLanguage' | 'speak' | 'stopSpeaking'>;

/** Looks like the browser's SpeechRecognition to the prototype, but listens through Scribe. */
export function createScribeRecognition(voice: VoiceLike, onStatus: NonNullable<VoiceBridgeOptions['onStatus']> = () => undefined) {
  let active: ScribeRecognition | null = null;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;

  class ScribeRecognition {
    lang = 'en-US';
    interimResults = true;
    continuous = false;
    onstart: (() => void) | null = null;
    onresult: ((e: { resultIndex: number; results: RecognitionResult[] }) => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    onend: (() => void) | null = null;

    start(): void {
      active = this;
      if (stopTimer) clearTimeout(stopTimer);
      stopTimer = null;
      voice.setLanguage(this.lang.toLowerCase().startsWith('th') ? 'th' : 'en');
      void voice.start(); // does nothing if the mic is already on
      this.onstart?.();
    }

    abort(): void {
      if (active === this) active = null;
      // Keep the mic for a while: the prototype restarts listening in a moment, and Icarus can be interrupted while it speaks.
      if (stopTimer) clearTimeout(stopTimer);
      stopTimer = setTimeout(() => {
        if (!active) voice.stop();
      }, MIC_LINGER_MS);
    }

    stop(): void {
      this.abort();
    }

    deliver(text: string, isFinal: boolean): void {
      const result = Object.assign([{ transcript: text }], { isFinal }) as RecognitionResult;
      this.onresult?.({ resultIndex: 0, results: [result] });
      if (isFinal) {
        if (active === this) active = null;
        this.onend?.();
      }
    }

    fail(error: string): void {
      this.onerror?.({ error });
    }
  }

  voice.on('partialTranscript', ({ text }) => active?.deliver(text, false));
  voice.on('finalTranscript', ({ text }) => {
    // "stop", "repeat that", "louder" and so on are handled by the voice module. The prototype must not also answer them.
    if (matchCommand(text, GLOBAL_COMMANDS)) return;
    active?.deliver(text, true);
  });
  voice.on('error', ({ code, message, fatal }) => {
    onStatus({ kind: 'error', text: `${code}: ${message}` });
    if (!fatal) return;
    // The prototype switches to its tap-a-phrase demo mode when it hears these.
    active?.fail(code === 'mic_denied' ? 'not-allowed' : 'service-not-allowed');
  });

  return ScribeRecognition;
}

export function installVoice(options: VoiceBridgeOptions = {}): IcarusVoice {
  const onStatus = options.onStatus ?? (() => undefined);
  const voice = new IcarusVoice({ serverUrl: options.serverUrl ?? '', language: 'en', assistant: 'external' });

  // Speech in: replace the browser's recognition before the prototype looks for it.
  const Recognition = createScribeRecognition(voice, onStatus);
  Object.assign(window, { SpeechRecognition: Recognition, webkitSpeechRecognition: Recognition });

  // "Go back" is a voice command the module recognises. The prototype does the navigating.
  voice.on('command', ({ name }) => {
    if (name === 'back') options.getComponent?.()?.goBack?.();
  });
  return voice;
}

/** Speech out. Call after the prototype has mounted (window.Icarus is created then). */
export function attachTts(voice: VoiceLike): boolean {
  const icarus = (window as unknown as { Icarus?: { setTTS?: (fn: unknown, stop: () => void) => void } }).Icarus;
  if (!icarus?.setTTS) return false;
  icarus.setTTS(
    async (speech: string, opts: { lang?: string; onProgress?: (i: number) => void } = {}) => {
      const started = Date.now();
      // The prototype highlights words as they are spoken. We estimate the progress, about 15 characters a second.
      const tick = setInterval(() => opts.onProgress?.(Math.min(speech.length, Math.round(((Date.now() - started) / 1000) * 15))), 110);
      try {
        await voice.speak(speech, { language: opts.lang === 'th' ? 'th' : 'en' });
      } finally {
        clearInterval(tick);
        opts.onProgress?.(speech.length);
      }
    },
    () => voice.stopSpeaking(),
  );
  return true;
}
