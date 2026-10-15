// The ONE place that picks the knowledge source.
//   UTOPIA_MODE=mock   the glossary in config/utopia-glossary.ts (default, U-Bot has no API yet)
//   UTOPIA_MODE=http   a real endpoint at UTOPIA_URL (see HttpUtopiaKnowledge for the request we propose)

import type { ServerConfig } from '../env';
import { HttpUtopiaKnowledge, MockUtopiaKnowledge, type UtopiaKnowledge } from './knowledge';
import { UtopiaService } from './service';

export function createUtopia(cfg: ServerConfig, log: (line: string) => void = (l) => console.log(l)): UtopiaService {
  let knowledge: UtopiaKnowledge;
  if (cfg.utopiaMode === 'http') {
    if (!cfg.utopiaUrl) throw new Error('UTOPIA_MODE=http needs UTOPIA_URL');
    knowledge = new HttpUtopiaKnowledge(cfg.utopiaUrl, cfg.utopiaApiKey, cfg.utopiaTimeoutMs, log);
  } else {
    knowledge = new MockUtopiaKnowledge();
  }
  return new UtopiaService(knowledge, cfg.ubotUrl, log);
}
