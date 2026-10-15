// Shared test setup: a server wired to the fake ElevenLabs and temp folders.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server/app';
import { MockAssistant } from '../src/server/assistant/mock';
import { loadConfig, type ServerConfig } from '../src/server/env';
import { createFakeElevenLabsPort, type FakeOptions } from '../src/server/fake-elevenlabs';
import { TtsCache } from '../src/server/tts-cache';
import { TtsService } from '../src/server/tts';
import { UsageTracker } from '../src/server/usage';
import type { FrictionEvent } from '../src/server/friction';
import type { SpeechArgs } from '../src/server/elevenlabs';

export const SECRET_KEY = 'test-secret-key-must-never-leak-123456';

export function makeConfig(extra: Record<string, string> = {}): ServerConfig {
  const dir = mkdtempSync(path.join(tmpdir(), 'icarus-test-'));
  return loadConfig({
    ELEVENLABS_API_KEY: SECRET_KEY,
    VOICE_ID_EN: 'voice-en',
    VOICE_ID_TH: 'voice-th',
    AUDIO_CACHE_DIR: path.join(dir, 'cache'),
    DEMO_AUDIO_DIR: path.join(dir, 'demo'),
    LOG_DIR: path.join(dir, 'logs'),
    MOCK_ASSISTANT_DELAY_MS: '0',
    ...extra,
  } as NodeJS.ProcessEnv);
}

export function makeStack(extra: Record<string, string> = {}, fake: FakeOptions = {}) {
  const cfg = makeConfig(extra);
  const requests: SpeechArgs[] = [];
  const port = createFakeElevenLabsPort({ firstByteDelayMs: 1, ...fake, onRequest: (a) => requests.push(a) });
  const logs: string[] = [];
  const usage = new UsageTracker((l) => logs.push(l));
  const cache = new TtsCache([cfg.cacheDir, cfg.demoAudioDir], cfg.cacheDir);
  const tts = new TtsService(cfg, port, cache, usage, (l) => logs.push(l));
  const frictionEvents: FrictionEvent[] = [];
  const app = createApp({
    cfg,
    assistant: new MockAssistant(0),
    tts,
    port,
    usage,
    friction: (e) => void frictionEvents.push(e),
    log: (l) => logs.push(l),
  });
  return { cfg, port, requests, logs, usage, cache, tts, app, frictionEvents };
}

/** Start the app on a random port. Call close() when done. */
export async function listen(app: ReturnType<typeof createApp>) {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

export async function collect(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const c of stream) parts.push(c);
  return Buffer.concat(parts);
}
