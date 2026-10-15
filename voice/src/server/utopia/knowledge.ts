// Where answers about U-topia come from.
//
//   MockUtopiaKnowledge : the glossary in config/utopia-glossary.ts. Used now, because U-Bot has no API.
//   HttpUtopiaKnowledge : calls a real endpoint. Written for when U-Bot has one. UNTESTED against the real thing.
//
// Both return null when they cannot answer. Null means "hand the user to U-Bot".

import type { Lang } from '../../shared/types';
import { findDefinition } from './router';

export interface KnowledgeAnswer {
  answer: string;
  source: 'mock' | 'u-bot';
  /** true only if someone at U-topia (or we, against U-Bot) checked this exact text. */
  verified: boolean;
  topic: string;
}

export interface UtopiaKnowledge {
  ask(question: string, language: Lang): Promise<KnowledgeAnswer | null>;
}

export class MockUtopiaKnowledge implements UtopiaKnowledge {
  async ask(question: string, language: Lang): Promise<KnowledgeAnswer | null> {
    const entry = findDefinition(question);
    if (!entry) return null;
    return { answer: language === 'th' ? entry.th : entry.en, source: 'mock', verified: entry.verified, topic: entry.id };
  }
}

/**
 * The request we would send to U-Bot, once it has an API. THIS IS OUR PROPOSAL, not their contract. Ask them.
 *
 *   POST  UTOPIA_URL
 *   Authorization: Bearer UTOPIA_API_KEY      (only if they need one; stays on the server)
 *   { "question": "What is U-Coin?", "language": "en", "context": "u-topia" }
 *   -> { "answer": "...", "verified": true }
 *
 * "context": "u-topia" mirrors what U-Bot's own app does in its "Ask U-Topia" mode: it puts
 * "[Context: question is about U-Topia]" in front of the question.
 */
export class HttpUtopiaKnowledge implements UtopiaKnowledge {
  constructor(
    private readonly url: string,
    private readonly apiKey: string | undefined,
    private readonly timeoutMs: number,
    private readonly log: (line: string) => void = () => undefined,
  ) {}

  async ask(question: string, language: Lang): Promise<KnowledgeAnswer | null> {
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
        body: JSON.stringify({ question, language, context: 'u-topia' }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) {
        this.log(`[utopia] the knowledge service answered HTTP ${res.status}`);
        return null;
      }
      const data = (await res.json()) as { answer?: unknown; verified?: unknown };
      const answer = typeof data.answer === 'string' ? data.answer.trim() : '';
      if (!answer) return null;
      return { answer, source: 'u-bot', verified: data.verified === true, topic: 'u-bot' };
    } catch (err) {
      this.log(`[utopia] the knowledge service failed: ${(err as Error).name === 'TimeoutError' ? 'timed out' : 'could not be reached'}`);
      return null;
    }
  }
}
