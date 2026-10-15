// Last-resort voice: the browser's built-in speech synthesis. Used only when the ElevenLabs
// call fails (no network, quota). It does not sound like Icarus, but the user still hears the
// words, and the full text is always on screen too.

import type { Lang } from '../shared/types';
import type { PlaybackHandle } from './player';

export type FallbackSpeaker = (text: string, lang: Lang, volume: number, rate: number, onStart: () => void) => PlaybackHandle | null;

export const browserSpeechFallback: FallbackSpeaker = (text, lang, volume, rate, onStart) => {
  if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return null;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang === 'th' ? 'th-TH' : 'en-US';
  utterance.volume = Math.min(1, volume);
  utterance.rate = rate;

  let settle: (r: 'finished' | 'stopped') => void = () => undefined;
  const finished = new Promise<'finished' | 'stopped'>((resolve) => {
    settle = resolve;
  });
  let stopped = false;
  utterance.onstart = onStart;
  utterance.onend = () => settle(stopped ? 'stopped' : 'finished');
  utterance.onerror = () => settle('stopped'); // an error is never a clean finish
  speechSynthesis.speak(utterance);

  return {
    finished,
    push: () => undefined,
    end: () => undefined,
    stop: () => {
      stopped = true;
      speechSynthesis.cancel();
      settle('stopped');
    },
  };
};
