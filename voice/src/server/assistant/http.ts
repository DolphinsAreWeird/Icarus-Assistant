// Adapter for the real assistant (Luka and First).
// If their brain runs as an HTTP service, set ASSISTANT_MODE=http and ASSISTANT_URL=...
// We POST { text, language, snapshot, userId } and expect { text, speak, ui_actions, sources }.
// (context.md section 8.) Missing fields are filled in safely.

import type { Assistant, AssistantReply, AssistantRequest, UiAction } from '../../shared/types';

export class HttpAssistant implements Assistant {
  constructor(
    private readonly url: string,
    private readonly timeoutMs: number,
  ) {}

  async ask(req: AssistantRequest): Promise<AssistantReply> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Assistant returned HTTP ${res.status}`);
    return normalizeReply(await res.json());
  }
}

/** Make sure whatever came back has the four fields the voice layer needs. */
export function normalizeReply(raw: unknown): AssistantReply {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (typeof r.text !== 'string') throw new Error('Assistant reply has no text');
  return {
    text: r.text,
    ...(typeof r.speech === 'string' && r.speech.trim() ? { speech: r.speech } : {}),
    ...(typeof r.emotion === 'string' ? { emotion: r.emotion } : {}),
    speak: typeof r.speak === 'boolean' ? r.speak : true,
    ui_actions: Array.isArray(r.ui_actions) ? (r.ui_actions as UiAction[]) : [],
    sources: Array.isArray(r.sources) ? (r.sources as AssistantReply['sources']) : [],
  };
}
