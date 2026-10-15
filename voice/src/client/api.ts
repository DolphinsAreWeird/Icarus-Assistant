// Talks to our voice server. The browser never calls ElevenLabs REST endpoints and never holds
// the API key. The only direct ElevenLabs connection is the speech-to-text socket, which uses
// a single-use token that the server mints.

import type { AskResponse, Lang, LangSetting, Mode, ScribeTokenResponse, Snapshot, TurnMetrics } from '../shared/types';

export class VoiceApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export interface TtsResponse {
  sampleRate: number;
  cache: 'hit' | 'miss';
  ttfbMs: number;
  model: string;
  /** Raw 16-bit little-endian mono PCM. */
  body: ReadableStream<Uint8Array>;
}

/** What the controller needs from the server. Tests replace this with a fake. */
export interface VoiceApiPort {
  scribeToken(language: LangSetting, mode: Mode): Promise<ScribeTokenResponse>;
  ask(req: { text: string; language: LangSetting; snapshot?: Snapshot; userId: string }, signal?: AbortSignal): Promise<AskResponse>;
  tts(req: { text: string; language: Lang; speed: number }, signal: AbortSignal): Promise<TtsResponse>;
  reportUsage(sttSeconds: number): void;
  logFriction(event: { type: string; screen: string | null; text: string; language: string; confidence: number | null; userId: string; source: string }): void;
  reportMetrics(metrics: TurnMetrics): void;
}

export class VoiceApi implements VoiceApiPort {
  constructor(
    private readonly baseUrl: string,
    private readonly sessionId: string,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  private async request(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-session-id': this.sessionId },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) {
      let code = 'http_error';
      let message = `Server returned ${res.status}`;
      try {
        const data = (await res.json()) as { error?: { code?: string; message?: string } };
        code = data.error?.code ?? code;
        message = data.error?.message ?? message;
      } catch {
        // Not JSON. Keep the generic message.
      }
      throw new VoiceApiError(code, message, res.status);
    }
    return res;
  }

  async scribeToken(language: LangSetting, mode: Mode): Promise<ScribeTokenResponse> {
    return (await (await this.request('/api/scribe-token', { language, mode })).json()) as ScribeTokenResponse;
  }

  async ask(req: { text: string; language: LangSetting; snapshot?: Snapshot; userId: string }, signal?: AbortSignal): Promise<AskResponse> {
    return (await (await this.request('/api/ask', req, signal)).json()) as AskResponse;
  }

  async tts(req: { text: string; language: Lang; speed: number }, signal: AbortSignal): Promise<TtsResponse> {
    const res = await this.request('/api/tts', req, signal);
    if (!res.body) throw new VoiceApiError('no_body', 'The server sent no audio.', 502);
    return {
      sampleRate: Number(res.headers.get('x-sample-rate') ?? 24000),
      cache: res.headers.get('x-tts-cache') === 'hit' ? 'hit' : 'miss',
      ttfbMs: Number(res.headers.get('x-tts-ttfb-ms') ?? 0),
      model: res.headers.get('x-tts-model') ?? '',
      body: res.body,
    };
  }

  // The next three are fire and forget. A failure must never disturb the conversation.
  reportUsage(sttSeconds: number): void {
    void this.request('/api/usage', { sttSeconds }).catch(() => undefined);
  }
  logFriction(event: Parameters<VoiceApiPort['logFriction']>[0]): void {
    void this.request('/api/friction', event).catch(() => undefined);
  }
  reportMetrics(metrics: TurnMetrics): void {
    void this.request('/api/turn-metrics', metrics).catch(() => undefined);
  }
}
