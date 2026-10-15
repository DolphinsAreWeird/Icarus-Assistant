// The only file that talks to the ElevenLabs SDK for speech and tokens.
// It sits behind a small interface (ElevenLabsPort) so tests and the offline demo mode
// can swap in a fake with no network.

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import type { ServerConfig } from './env';

export interface SpeechArgs {
  voiceId: string;
  text: string;
  modelId: string;
  outputFormat: string;
  languageCode?: string;
  /** 1 is normal. ElevenLabs supports about 0.7 to 1.2. */
  speed?: number;
}

export interface ElevenLabsPort {
  /** Stream raw audio. Throws an error with `statusCode` on HTTP errors. */
  streamSpeech(args: SpeechArgs, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>>;
  /** Short-lived token for browser-side Scribe. Valid for 15 minutes, single use. */
  createRealtimeToken(): Promise<string>;
}

export function createElevenLabsPort(cfg: ServerConfig): ElevenLabsPort {
  if (!cfg.apiKey) {
    throw new Error('ELEVENLABS_API_KEY is not set. Copy .env.example to .env and add it, or set FAKE_ELEVENLABS=1.');
  }
  const client = new ElevenLabsClient({
    apiKey: cfg.apiKey,
    ...(cfg.restBaseUrl ? { baseUrl: cfg.restBaseUrl } : {}),
    // The SDK retries 429 and 5xx by default. One retry is enough for a live conversation.
    maxRetries: 1,
    timeoutInSeconds: 30,
  });

  return {
    async streamSpeech(args, signal) {
      return client.textToSpeech.stream(
        args.voiceId,
        {
          text: args.text,
          modelId: args.modelId,
          outputFormat: args.outputFormat as never,
          ...(args.languageCode ? { languageCode: args.languageCode } : {}),
          ...(args.speed && args.speed !== 1 ? { voiceSettings: { speed: args.speed } } : {}),
        },
        signal ? { abortSignal: signal } : undefined,
      );
    },
    async createRealtimeToken() {
      const result = await client.tokens.singleUse.create('realtime_scribe');
      return result.token;
    },
  };
}

export interface UpstreamInfo {
  statusCode: number | undefined;
  /** ElevenLabs' own error code, for example "invalid_uid" or "invalid_api_key". */
  apiStatus: string | undefined;
  message: string;
}

/** Read the useful parts of an SDK error. The body can be an object or a string. */
export function upstreamInfo(err: unknown): UpstreamInfo {
  const e = err as { statusCode?: number; body?: unknown; message?: string } | null;
  let body: unknown = e?.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      // Keep the string.
    }
  }
  const detail = (body as { detail?: { status?: string; message?: string } } | undefined)?.detail;
  return {
    statusCode: e?.statusCode,
    apiStatus: typeof detail?.status === 'string' ? detail.status : undefined,
    message: detail?.message ?? e?.message ?? 'Unknown error',
  };
}

/** ElevenLabs does not recognise the voice ID. Another model will not help. */
export function isBadVoice(err: unknown): boolean {
  const info = upstreamInfo(err);
  return info.apiStatus === 'invalid_uid' || (info.statusCode === 404 && /voice/i.test(info.message));
}

/**
 * True when ElevenLabs refused the request because of the MODEL (or its settings), so trying
 * the next model may work. A bad voice ID also comes back as a 400, so it is checked first.
 */
export function isModelRejection(err: unknown): boolean {
  if (isBadVoice(err)) return false;
  const status = upstreamInfo(err).statusCode;
  return status === 400 || status === 404 || status === 422;
}
