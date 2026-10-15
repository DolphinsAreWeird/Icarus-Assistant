// Matches what the user said against the editable phrase lists in config/voice-commands.ts.
// Runs in the browser. Nothing here calls the assistant.

import {
  LEADING_FILLERS,
  TRAILING_FILLERS,
  VOICE_COMMANDS,
  type CommandName,
} from '../config/voice-commands';
import { hasThai } from './lang';

/** Commands where a wrong match costs nothing, so a short sentence containing the phrase is enough. */
const SAFE_COMMANDS: ReadonlySet<CommandName> = new Set(['stop', 'cancel']);
/** For safe commands, longer sentences than this are not treated as commands. */
const SAFE_MAX_WORDS = 3;

/** Lowercase, drop punctuation, collapse spaces. */
export function normalizeUtterance(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[.,!?;:"'`~()[\]{}…。、，！？]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimEnglishFillers(text: string): string {
  let out = text;
  let changed = true;
  while (changed) {
    changed = false;
    for (const filler of LEADING_FILLERS.en) {
      if (out.startsWith(`${filler} `)) {
        out = out.slice(filler.length + 1);
        changed = true;
      }
    }
    for (const filler of TRAILING_FILLERS.en) {
      if (out.endsWith(` ${filler}`)) {
        out = out.slice(0, -(filler.length + 1));
        changed = true;
      }
    }
  }
  return out;
}

/** Thai has no spaces, so we trim particles from the spaceless text. */
function trimThaiFillers(compact: string): string {
  let out = compact;
  let changed = true;
  while (changed) {
    changed = false;
    for (const filler of LEADING_FILLERS.th) {
      if (out.startsWith(filler) && out.length > filler.length) {
        out = out.slice(filler.length);
        changed = true;
      }
    }
    for (const filler of TRAILING_FILLERS.th) {
      if (out.endsWith(filler) && out.length > filler.length) {
        out = out.slice(0, -filler.length);
        changed = true;
      }
    }
  }
  return out;
}

const compactOf = (s: string) => s.replace(/\s+/g, '');

/**
 * Which of the allowed commands did the user say? Order of `allowed` is the priority.
 * Returns null when nothing matches, which means "treat it as a normal question".
 */
export function matchCommand(text: string, allowed: CommandName[]): CommandName | null {
  const spaced = trimEnglishFillers(normalizeUtterance(text));
  const compact = trimThaiFillers(compactOf(spaced));
  if (!compact) return null;
  const wordCount = spaced.split(' ').filter(Boolean).length;

  for (const name of allowed) {
    const phrases = [...VOICE_COMMANDS[name].en, ...VOICE_COMMANDS[name].th];
    // 1. Exact match of the whole utterance.
    if (phrases.some((p) => compactOf(normalizeUtterance(p)) === compact)) return name;

    // 2. Safe commands: a short sentence that contains the phrase.
    if (SAFE_COMMANDS.has(name) && wordCount <= SAFE_MAX_WORDS) {
      for (const phrase of phrases) {
        const p = normalizeUtterance(phrase);
        if (hasThai(p)) {
          if (compact.includes(compactOf(p)) && compact.length <= compactOf(p).length + 12) return name;
        } else if (` ${spaced} `.includes(` ${p} `)) {
          return name;
        }
      }
    }
  }
  return null;
}

/** Commands that can be said any time. confirm and cancel only count during a money confirmation. */
export const GLOBAL_COMMANDS: CommandName[] = ['stop', 'repeat', 'back', 'louder', 'slower'];
