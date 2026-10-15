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
export function createScribeRecognition(
  voice: VoiceLike,
  onStatus: NonNullable<VoiceBridgeOptions['onStatus']> = () => undefined,
  /** Is the prototype's voice window open? The mic is only allowed on while it is. */
  isVoiceOpen: () => boolean = () => true,
) {
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
      // While the voice window is open, keep the mic for a while: the prototype restarts listening in a moment,
      // and Icarus can be interrupted while it speaks. Once the window is closed, the mic goes off at once and
      // Icarus stops talking: it must not hear or answer the user when they did not open it.
      // (The prototype closes the window just after it stops listening, so we check again shortly after.)
      if (stopTimer) clearTimeout(stopTimer);
      const lingerUntil = Date.now() + MIC_LINGER_MS;
      const check = () => {
        if (active) return;
        if (!isVoiceOpen()) {
          voice.stopSpeaking();
          voice.stop();
        } else if (Date.now() >= lingerUntil) voice.stop();
        else stopTimer = setTimeout(check, 250);
      };
      stopTimer = setTimeout(check, 250);
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
  const isVoiceOpen = () => (options.getComponent?.() as { state?: { asst?: string } } | null)?.state?.asst === 'voice';
  const Recognition = createScribeRecognition(voice, onStatus, isVoiceOpen);
  Object.assign(window, { SpeechRecognition: Recognition, webkitSpeechRecognition: Recognition });

  // Only one tab may listen and talk. With two tabs open, both heard the user and both answered out loud.
  // The tab that starts listening tells the others to go quiet. A quiet tab stays quiet until the user
  // clicks or types in it, or its prototype would restart listening by itself and the tabs would fight.
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('icarus-voice');
    let paused = false;
    const resume = () => (paused = false);
    window.addEventListener('pointerdown', resume, true);
    window.addEventListener('keydown', resume, true);
    const start = Recognition.prototype.start;
    Recognition.prototype.start = function (this: InstanceType<typeof Recognition>) {
      if (paused) return;
      channel.postMessage('claim');
      start.call(this);
    };
    channel.onmessage = () => {
      paused = true;
      voice.stopSpeaking();
      voice.stop();
      onStatus({ kind: 'info', text: 'Voice paused: Icarus is listening in another tab. Click here to take it back.' });
    };
  }

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
