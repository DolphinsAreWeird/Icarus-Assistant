// The one thing the rest of the code calls: "what should we do with this request?"
//
// Proposed agent tools for Luka and First (same idea as the tools table in context.md section 8):
//   ask_utopia(question, language)  -> { answer, source, verified } or a handoff
//   handoff_to_ubot(reason, question, language) -> a handoff
// Both are covered by route(). It is also served over HTTP at POST /api/utopia/route.

import { DEFAULT_UBOT_URL, HANDOFF_COPY } from '../../config/handoff';
import { detectLang } from '../../shared/lang';
import type { Handoff, HandoffReason, Lang, LangSetting, UtopiaRoute } from '../../shared/types';
import type { UtopiaKnowledge } from './knowledge';
import { classify, isAdviceRequest, looksLikeRequest } from './router';
import { checkAnswerSafe } from './safety';

export function buildHandoff(reason: HandoffReason, question: string, lang: Lang, url: string = DEFAULT_UBOT_URL, mock = false): Handoff {
  const copy = HANDOFF_COPY[lang];
  return { target: 'u-bot', reason, label: copy.label, message: copy.messages[reason], url, question, ...(mock ? { mock: true } : {}) };
}

/** Where "Open U-Bot" goes: a fixed address (the real U-Bot), or a fresh link per handoff (the U-Bot mock). */
export type HandoffTarget = string | { urlFor: (question: string, reason: HandoffReason, lang: Lang) => string; mock: true };

export class UtopiaService {
  constructor(
    private readonly knowledge: UtopiaKnowledge,
    private readonly target: HandoffTarget = DEFAULT_UBOT_URL,
    private readonly log: (line: string) => void = () => undefined,
  ) {}

  private handoff(reason: HandoffReason, question: string, lang: Lang): Handoff {
    if (typeof this.target === 'string') return buildHandoff(reason, question, lang, this.target);
    return buildHandoff(reason, question, lang, this.target.urlFor(question, reason, lang), true);
  }

  /**
   * @param fallback  true when Icarus itself did not understand the request. A long enough request then gets a
   *                  general handoff instead of a dead end. A short or garbled one does not (it is probably a mishearing).
   */
  async route(text: string, language: LangSetting, opts: { fallback?: boolean } = {}): Promise<UtopiaRoute> {
    const question = text.trim();
    const lang: Lang = language === 'auto' ? detectLang(question) : language;
    const decision = classify(question);

    switch (decision.kind) {
      case 'utopia': {
        const found = await this.knowledge.ask(question, lang).catch((err) => {
          this.log(`[utopia] the knowledge source failed: ${(err as Error).message}`);
          return null;
        });
        if (found) {
          // Words we did not write still obey the hard rules.
          const verdict = checkAnswerSafe(found.answer);
          if (verdict.ok) {
            return { kind: 'answer', answer: found.answer, language: lang, source: found.source, verified: found.verified, topic: found.topic };
          }
          this.log(`[utopia] an answer was not used (${verdict.reason}). Handing the user to U-Bot.`);
        }
        return { kind: 'handoff', handoff: this.handoff('utopia_question', question, lang), language: lang };
      }
      case 'commerce':
        return { kind: 'handoff', handoff: this.handoff('commerce', question, lang), language: lang };
      case 'general':
        return { kind: 'handoff', handoff: this.handoff('general', question, lang), language: lang };
      case 'none':
        if (opts.fallback && looksLikeRequest(question) && !isAdviceRequest(question)) {
          return { kind: 'handoff', handoff: this.handoff('general', question, lang), language: lang };
        }
        return { kind: 'none' };
    }
  }
}
