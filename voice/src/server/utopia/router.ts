// Decides what kind of request this is. Pure functions: no network, easy to test.
//
//   advice about investing or U-topia -> 'none'  Icarus refuses it itself (hard rule 1). Never passed on.
//   mentions U-topia  -> 'utopia'   answer from the glossary / U-Bot, or hand off
//   travel, rides...  -> 'commerce' hand off to U-Bot
//   draw, write...    -> 'general'  hand off to U-Bot
//   anything else     -> 'none'     a normal in-app request, Icarus handles it

import { ADVICE, COMMERCE, GENERAL, INVESTING } from '../../config/handoff';
import { UTOPIA_GLOSSARY, type GlossaryEntry } from '../../config/utopia-glossary';

export type Decision = { kind: 'none' } | { kind: 'utopia' } | { kind: 'commerce' } | { kind: 'general' };

/** "u-coin" matches "u-coin", "u coin" and "ucoin". */
function termSource(term: string): string {
  return term
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/[-\s]/g, '[\\s-]?');
}

interface CompiledEntry {
  entry: GlossaryEntry;
  /** Matches any of the entry's terms. */
  anyTerm: RegExp;
  /** The longest term that matched (more specific wins): used to pick between "u-topia" and "u-topia pay". */
  terms: Array<{ length: number; re: RegExp; source: string }>;
}

function compile(glossary: GlossaryEntry[]): CompiledEntry[] {
  return glossary.map((entry) => {
    const terms = entry.terms.map((t) => ({ length: t.length, source: termSource(t), re: new RegExp(termSource(t), 'i') }));
    return { entry, terms, anyTerm: new RegExp(terms.map((t) => `(?:${t.source})`).join('|'), 'i') };
  });
}

const COMPILED = compile(UTOPIA_GLOSSARY);

/** Does the text mention anything from the U-topia world? */
export function mentionsUtopia(text: string, compiled: CompiledEntry[] = COMPILED): boolean {
  return compiled.some((c) => c.anyTerm.test(text));
}

/** "What should I buy?" Never handed off: Icarus refuses it itself (hard rule 1). */
export function isAdviceRequest(text: string): boolean {
  return ADVICE.test(text);
}

export function classify(text: string, compiled: CompiledEntry[] = COMPILED): Decision {
  const utopia = mentionsUtopia(text, compiled);
  // Advice about investing, or about anything in the U-topia world, is never handed off.
  // ("Recommend a hotel" is not investment advice, so it can still go to U-Bot.)
  if (isAdviceRequest(text) && (utopia || INVESTING.test(text))) return { kind: 'none' };
  if (utopia) return { kind: 'utopia' };
  if (COMMERCE.test(text)) return { kind: 'commerce' };
  if (GENERAL.test(text)) return { kind: 'general' };
  return { kind: 'none' };
}

// ---- Definitions ----

const EN_INTRO = "(?:what(?:'s|s)?|who|tell me about|explain|describe|meaning of|define)";
const EN_VERB = '(?:\\s+(?:is|are|does|do))?';
const EN_ARTICLE = '(?:\\s+(?:a|an|the))?';

/**
 * "What is U-Coin?" is a definition. "How do I buy U-Coin?" and "What are the fees on U-Pay?" are not:
 * the glossary only defines things, so those go to U-Bot instead of getting a wrong, generic answer.
 */
export function findDefinition(text: string, compiled: CompiledEntry[] = COMPILED): GlossaryEntry | null {
  const lowered = text.toLowerCase().replace(/[?!.,]+/g, ' ').replace(/\s+/g, ' ').trim();
  let best: { entry: GlossaryEntry; length: number } | null = null;

  for (const { entry, terms } of compiled) {
    for (const term of terms) {
      if (!term.re.test(lowered)) continue;
      const thai = /[฀-๿]/.test(term.source);
      const definitional = thai
        ? new RegExp(`(?:${term.source})\\s*(?:คืออะไร|คือ|หมายถึง|ทำอะไร)|(?:อธิบาย|เล่า.{0,12}เกี่ยวกับ|บอก.{0,12}เกี่ยวกับ)\\s*(?:${term.source})`).test(lowered)
        : new RegExp(`\\b${EN_INTRO}${EN_VERB}${EN_ARTICLE}\\s+(?:${term.source})(?![\\w-])`, 'i').test(lowered) ||
          new RegExp(`^(?:${term.source})\\s*$`, 'i').test(lowered); // just the name on its own
      if (definitional && (!best || term.length > best.length)) best = { entry, length: term.length };
    }
  }
  return best?.entry ?? null;
}

/** Long enough to be a real request, not a misheard word. Used to decide whether "I did not understand" deserves a handoff. */
export function looksLikeRequest(text: string): boolean {
  const t = text.trim();
  if (/[฀-๿]/.test(t)) return t.replace(/\s+/g, '').length >= 12;
  return t.split(/\s+/).filter(Boolean).length >= 4;
}
