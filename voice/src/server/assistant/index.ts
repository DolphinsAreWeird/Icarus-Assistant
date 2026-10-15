// The ONE place that decides which assistant answers.
// Swap with one config change in .env:
//   ASSISTANT_MODE=mock   canned replies (default)
//   ASSISTANT_MODE=http   the real brain, at ASSISTANT_URL
//
// Prefer calling the brain in-process instead? Write a class with `ask(req)` that returns an
// AssistantReply and return it from createAssistant() below.

import type { Assistant } from '../../shared/types';
import type { ServerConfig } from '../env';
import type { UtopiaService } from '../utopia/service';
import { HttpAssistant } from './http';
import { MockAssistant } from './mock';

export function createAssistant(cfg: ServerConfig, utopia?: UtopiaService): Assistant {
  if (cfg.assistantMode === 'http') {
    if (!cfg.assistantUrl) throw new Error('ASSISTANT_MODE=http needs ASSISTANT_URL');
    return new HttpAssistant(cfg.assistantUrl, cfg.assistantTimeoutMs);
  }
  return new MockAssistant(cfg.mockDelayMs, utopia);
}
