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
export function attachTts(voice: VoiceLike, getComponent: () => unknown = () => null): boolean {
  const icarus = (window as unknown as { Icarus?: { setTTS?: (fn: unknown, stop: () => void) => void } }).Icarus;
  if (!icarus?.setTTS) return false;
  icarus.setTTS(
    async (speech: string, opts: { lang?: string; onProgress?: (i: number) => void } = {}) => {
      // The prototype starts a guess-timer (about 70 ms a character) just before calling us, and moves on to the
      // next line when it fires, even mid-sentence. Our promise already says when the audio really ends, so cancel it.
      const component = getComponent() as { _st?: ReturnType<typeof setTimeout> } | null;
      if (component?._st) clearTimeout(component._st);
      // The prototype highlights words as they are spoken. We estimate about 15 characters a second,
      // counted from the first audio, not from the request, so the caption does not run ahead of the voice.
      let started = 0;
      const offStart = voice.on('speakingStart', () => (started = Date.now()));
      const tick = setInterval(() => {
        if (started) opts.onProgress?.(Math.min(speech.length - 1, Math.round(((Date.now() - started) / 1000) * 15)));
      }, 110);
      try {
        // Go by the text, not only the setting: a Thai reply while the app is set to English must still get the Thai model.
        const thai = opts.lang === 'th' || /[฀-๿]/.test(speech);
        await voice.speak(speech, { language: thai ? 'th' : 'en' });
      } finally {
        offStart();
        clearInterval(tick);
        opts.onProgress?.(speech.length);
      }
    },
    () => voice.stopSpeaking(),
  );
  return true;
}
