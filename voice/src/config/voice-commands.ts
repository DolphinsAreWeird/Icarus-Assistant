// Local voice commands. These are handled in the browser WITHOUT calling the assistant.
// Edit the lists to add or remove phrases. Thai teammate: check the `th` lists.
//
// How matching works (see src/shared/commands.ts):
//  - Text is lowercased, punctuation is removed, and filler words (please, ok, ครับ...) are trimmed.
//  - The whole utterance must equal one of the phrases.
//  - For the safe commands (stop, cancel) a short sentence that contains the phrase also works,
//    so "no, cancel that please" cancels. Safe means: doing it by mistake costs nothing.
//  - "confirm" is NEVER matched loosely. It must be an exact phrase.
//
// Thai has no spaces between words, so Thai matching ignores spaces.

export type CommandName = 'stop' | 'repeat' | 'back' | 'louder' | 'slower' | 'confirm' | 'cancel';

export interface PhraseList {
  en: string[];
  th: string[];
}

export const VOICE_COMMANDS: Record<CommandName, PhraseList> = {
  // Stop talking. Also cancels a countdown.
  stop: {
    en: ['stop', 'wait', 'hold on', 'hang on', 'one second', 'be quiet', 'quiet'],
    th: ['หยุด', 'รอก่อน', 'เดี๋ยวก่อน', 'รอแป๊บ', 'เงียบ'],
  },
  repeat: {
    en: ['repeat that', 'repeat', 'say that again', 'say again', 'what was that', 'come again'],
    th: ['พูดอีกครั้ง', 'พูดอีกที', 'พูดซ้ำ', 'ขออีกที', 'ซ้ำ'],
  },
  back: {
    en: ['go back', 'back', 'previous screen', 'take me back'],
    th: ['ย้อนกลับ', 'กลับไป', 'กลับ'],
  },
  louder: {
    en: ['louder', 'speak up', 'turn it up', 'volume up'],
    th: ['ดังขึ้น', 'เสียงดังขึ้น', 'พูดดังขึ้น'],
  },
  slower: {
    en: ['slower', 'slow down', 'speak slower', 'too fast'],
    th: ['ช้าลง', 'พูดช้าลง', 'พูดช้าๆ'],
  },
  // Only used while Icarus is waiting for a yes or no on a money preview.
  confirm: {
    en: ['confirm', 'i confirm'],
    th: ['ยืนยัน', 'ยืนยันเลย'],
  },
  cancel: {
    en: ['cancel', 'never mind', 'nevermind', 'no cancel'],
    th: ['ยกเลิก', 'ยกเลิกเลย', 'ไม่เอา', 'ไม่ต้อง'],
  },
};

// Words ignored at the start or end of an utterance before matching.
// "yes" is only ever a filler here. "yes" alone never confirms anything.
export const LEADING_FILLERS: PhraseList = {
  en: ['please', 'okay', 'ok', 'yes', 'yeah', 'yep', 'hey', 'uh', 'um', 'just', 'so'],
  th: ['โอเค', 'ใช่', 'เอ่อ', 'อืม'],
};
export const TRAILING_FILLERS: PhraseList = {
  en: ['please', 'now', 'thanks', 'thank you', 'it', 'that'],
  th: ['ครับ', 'ค่ะ', 'คะ', 'นะครับ', 'นะคะ', 'นะ', 'หน่อย', 'ด้วย'],
};

// Fragments that are probably noise, not a real turn. Used by the short-fragment filter.
export const NOISE_FRAGMENTS: PhraseList = {
  en: ['uh', 'um', 'hmm', 'mm', 'mhm', 'huh', 'ah', 'oh', 'the', 'a', 'and', 'yeah', 'okay'],
  th: ['อืม', 'เอ่อ', 'อ๋อ', 'ฮะ', 'อะ', 'ครับ', 'ค่ะ'],
};
