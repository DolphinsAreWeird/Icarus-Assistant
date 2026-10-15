// The ONE place that picks the knowledge source.
//   UTOPIA_MODE=mock   the glossary in config/utopia-glossary.ts (default, U-Bot has no API yet)
//   UTOPIA_MODE=http   a real endpoint at UTOPIA_URL (see HttpUtopiaKnowledge for the request we propose)

//   UBOT_MODE=mock     "Open U-Bot" opens our U-Bot mock with the question carried over (default)
//   UBOT_MODE=link     "Open U-Bot" opens the real U-Bot's front door (UBOT_URL), where the user signs in

import type { ServerConfig } from '../env';
import { mockHandoffUrl, type UbotSessions } from '../ubot-mock';
import { HttpUtopiaKnowledge, MockUtopiaKnowledge, type UtopiaKnowledge } from './knowledge';
import { UtopiaService, type HandoffTarget } from './service';

export function createUtopia(cfg: ServerConfig, log: (line: string) => void = (l) => console.log(l), sessions?: UbotSessions): UtopiaService {
  let knowledge: UtopiaKnowledge;
  if (cfg.utopiaMode === 'http') {
    if (!cfg.utopiaUrl) throw new Error('UTOPIA_MODE=http needs UTOPIA_URL');
    knowledge = new HttpUtopiaKnowledge(cfg.utopiaUrl, cfg.utopiaApiKey, cfg.utopiaTimeoutMs, log);
  } else {
    knowledge = new MockUtopiaKnowledge();
  }
  const target: HandoffTarget = cfg.ubotMode === 'mock' && sessions ? { urlFor: mockHandoffUrl(sessions), mock: true } : cfg.ubotUrl;
  return new UtopiaService(knowledge, target, log);
}
