// A stand-in for U-Bot (UBOT_MODE=mock), until U-topia shares an API. Two halves:
//
//   1. The "Ask U-topia" API we PROPOSE (see utopia/knowledge.ts, HttpUtopiaKnowledge):
//        POST /mock/ubot/ask  { question, language, context: "u-topia" }  ->  { answer, verified: false, mock: true }
//      Answers come from our glossary. Point UTOPIA_MODE=http at it to exercise the HTTP path end to end.
//
//   2. A handoff with the user's question carried over, which U-Bot's front door cannot do today:
//        a handoff creates a session  ->  the "Open U-Bot" button opens /app/?page=ubot&session=<id>
//        GET  /mock/ubot/session/:id         the question, why it was handed off, the language
//        POST /mock/ubot/session/:id/reply   U-Bot's mock answer: sample options to review and pay in U-topia Pay
//      The page says on screen that it is a mock with sample data. Nothing is booked and no money moves.
//
// The session id is in the link, not the question: the user's words stay on the server.

import { randomBytes } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { mockReply } from '../../config/ubot-mock';
import type { HandoffReason, Lang } from '../../shared/types';
import { findDefinition } from '../utopia/router';

export interface UbotSession {
  id: string;
  question: string;
  reason: HandoffReason;
  language: Lang;
  createdAt: number;
}

const REASONS: HandoffReason[] = ['utopia_question', 'commerce', 'general'];

export class UbotSessions {
  private readonly sessions = new Map<string, UbotSession>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly ttlMs = 60 * 60 * 1000,
    private readonly max = 200,
  ) {}

  create(question: string, reason: HandoffReason, language: Lang): UbotSession {
    for (const [id, s] of this.sessions) if (this.now() - s.createdAt > this.ttlMs) this.sessions.delete(id);
    while (this.sessions.size >= this.max) this.sessions.delete(this.sessions.keys().next().value as string);
    const session = { id: randomBytes(8).toString('hex'), question: question.slice(0, 500), reason, language, createdAt: this.now() };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): UbotSession | undefined {
    const s = this.sessions.get(id);
    if (s && this.now() - s.createdAt > this.ttlMs) {
      this.sessions.delete(id);
      return undefined;
    }
    return s;
  }
}

/** Where "Open U-Bot" goes for a new handoff, in mock mode. */
export function mockHandoffUrl(sessions: UbotSessions, appPath = '/app/') {
  return (question: string, reason: HandoffReason, language: Lang) => `${appPath}?page=ubot&session=${sessions.create(question, reason, language).id}`;
}

export function mountUbotMock(app: Express, sessions: UbotSessions): void {
  const lang = (v: unknown): Lang => (v === 'th' ? 'th' : 'en');
  const bad = (res: Response, message: string) => res.status(400).json({ error: { code: 'bad_request', message } });
  const session = (req: Request, res: Response): UbotSession | null => {
    const s = /^[0-9a-f]{16}$/.test(String(req.params.id)) ? sessions.get(String(req.params.id)) : undefined;
    if (!s) res.status(404).json({ error: { code: 'session_not_found', message: 'This handoff has expired. Ask Icarus again.' } });
    return s ?? null;
  };

  app.post('/mock/ubot/ask', (req, res) => {
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    if (!question || question.length > 1000) return bad(res, 'question is required (up to 1000 characters).');
    const entry = findDefinition(question);
    if (!entry) return res.status(404).json({ error: { code: 'unknown', message: 'The mock does not know this one.' } });
    return res.json({ answer: lang(req.body?.language) === 'th' ? entry.th : entry.en, verified: false, mock: true });
  });

  app.post('/mock/ubot/handoff', (req, res) => {
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    const reason = REASONS.includes(req.body?.reason) ? (req.body.reason as HandoffReason) : 'general';
    if (!question || question.length > 500) return bad(res, 'question is required (up to 500 characters).');
    const s = sessions.create(question, reason, lang(req.body?.language));
    return res.json({ session_id: s.id, url: `/app/?page=ubot&session=${s.id}` });
  });

  app.get('/mock/ubot/session/:id', (req, res) => {
    const s = session(req, res);
    if (s) res.json({ question: s.question, reason: s.reason, language: s.language, mock: true });
  });

  app.post('/mock/ubot/session/:id/reply', (req, res) => {
    const s = session(req, res);
    if (s) res.json(mockReply(s.question, s.reason, s.language));
  });
}
