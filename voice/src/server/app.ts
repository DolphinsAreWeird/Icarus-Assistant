// The HTTP server. The browser module talks to these endpoints.
//
//   POST /api/scribe-token   mint a single-use STT token + ready-made wss URL (no API key inside)
//   POST /api/ask            text -> assistant -> reply + what to say out loud
//   POST /api/tts            text -> streamed raw PCM audio (cached)
//   POST /api/usage          browser reports STT seconds
//   POST /api/friction       every final transcript goes to the logFriction stub
//   POST /api/turn-metrics   per-turn latency numbers
//   GET  /api/health         what is configured (never returns the key)
//
// The API key stays on this server. The browser never sees it.

import express, { type NextFunction, type Request, type Response } from 'express';
import { appendFile, mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { buildSttUrl } from '../shared/stt-protocol';
import type { AskResponse, Assistant, Lang, LangSetting, Mode, ScribeTokenResponse, Snapshot } from '../shared/types';
import type { ElevenLabsPort } from './elevenlabs';
import { VOICE_ROOT, makeRedactor, type ServerConfig } from './env';
import type { FrictionSink } from './friction';
import { planSpeech } from './speech-plan';
import { TtsError, type TtsService } from './tts';
import type { UsageTracker } from './usage';

export interface AppDeps {
  cfg: ServerConfig;
  assistant: Assistant;
  tts: TtsService;
  /** null when there is no API key. STT and TTS then answer 503 with a clear message. */
  port: ElevenLabsPort | null;
  usage: UsageTracker;
  friction: FrictionSink;
  log?: (line: string) => void;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function createApp(deps: AppDeps): express.Express {
  const { cfg, assistant, tts, port, usage, friction } = deps;
  const log = deps.log ?? ((l: string) => console.log(l));
  const redact = makeRedactor(cfg.apiKey);
  const app = express();
  app.disable('x-powered-by');

  // ---- CORS: Oasis's frontend runs on another port while developing ----
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (cfg.allowedOrigins === '*') res.setHeader('Access-Control-Allow-Origin', '*');
    else if (origin && cfg.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-session-id');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'X-Sample-Rate, X-Audio-Format, X-TTS-Cache, X-TTS-Model, X-TTS-TTFB-Ms');
    if (req.method === 'OPTIONS') return void res.status(204).end();
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  const sessionOf = (req: Request): string => {
    const raw = req.header('x-session-id') ?? '';
    return /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : 'anonymous';
  };
  const fail = (res: Response, status: number, code: string, message: string) =>
    void res.status(status).json({ error: { code, message } });

  // ---- health ----
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      fakeElevenLabs: cfg.fakeElevenLabs,
      apiKeySet: Boolean(cfg.apiKey), // true or false only. Never the key.
      voices: { en: Boolean(cfg.voiceIdEn), th: Boolean(cfg.voiceIdTh) },
      ttsModels: { en: cfg.ttsModelsEn, th: cfg.ttsModelsTh },
      assistant: cfg.assistantMode,
      stt: { commitStrategy: cfg.stt.commitStrategy, vadSilenceSecs: cfg.stt.vadSilenceSecs },
    });
  });

  // ---- speech-to-text token ----
  app.post('/api/scribe-token', async (req, res) => {
    const language: LangSetting = ['en', 'th', 'auto'].includes(req.body?.language) ? req.body.language : 'en';
    const mode: Mode = req.body?.mode === 'push-to-talk' ? 'push-to-talk' : 'hands-free';
    if (!port) return fail(res, 503, 'no_api_key', 'ELEVENLABS_API_KEY is not set on the server.');
    try {
      const token = await port.createRealtimeToken();
      // Push-to-talk commits by hand when the button is released. Hands-free lets Scribe detect the end of speech.
      const commitStrategy = mode === 'push-to-talk' ? 'manual' : cfg.stt.commitStrategy === 'manual' ? 'vad' : cfg.stt.commitStrategy;
      const url = buildSttUrl({
        baseUrl: cfg.sttWsBaseUrl,
        token,
        ...(language !== 'auto' ? { languageCode: language } : {}),
        commitStrategy,
        vadSilenceSecs: cfg.stt.vadSilenceSecs,
        vadThreshold: cfg.stt.vadThreshold,
        minSpeechMs: cfg.stt.minSpeechMs,
        minSilenceMs: cfg.stt.minSilenceMs,
        keyterms: cfg.stt.keyterms,
        noVerbatim: cfg.stt.noVerbatim,
        detectLanguage: language === 'auto',
      });
      const body: ScribeTokenResponse = { url, commitStrategy, expiresInSec: 15 * 60 };
      res.setHeader('Cache-Control', 'no-store');
      res.json(body);
    } catch (err) {
      log(`[stt] token request failed: ${redact((err as Error).message)}`);
      fail(res, 502, 'token_failed', 'Could not get a speech-to-text token.');
    }
  });

  // ---- assistant ----
  app.post('/api/ask', async (req, res) => {
    const body = isObject(req.body) ? req.body : {};
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 2000) return fail(res, 400, 'bad_request', 'text is required (up to 2000 characters).');
    const language: LangSetting = ['en', 'th', 'auto'].includes(body.language as string) ? (body.language as LangSetting) : 'en';
    const userId = typeof body.userId === 'string' && body.userId ? body.userId.slice(0, 100) : 'demo-user';
    const snapshot = isObject(body.snapshot) ? (body.snapshot as Snapshot) : undefined;

    const started = performance.now();
    try {
      const reply = await assistant.ask({ text, language, ...(snapshot ? { snapshot } : {}), userId });
      const assistantMs = Math.round(performance.now() - started);
      const response: AskResponse = { reply, ...planSpeech(reply, language, text), assistantMs };
      res.json(response);
    } catch (err) {
      log(`[ask] assistant failed: ${redact((err as Error).message)}`);
      fail(res, 502, 'assistant_failed', 'The assistant did not answer.');
    }
  });

  // ---- text-to-speech (streamed) ----
  app.post('/api/tts', async (req, res) => {
    const body = isObject(req.body) ? req.body : {};
    const text = typeof body.text === 'string' ? body.text : '';
    const lang: Lang = body.language === 'th' ? 'th' : 'en';
    const speed = typeof body.speed === 'number' && body.speed >= 0.5 && body.speed <= 1.5 ? body.speed : 1;

    // If the browser hangs up (barge-in), stop the upstream request too.
    const abort = new AbortController();
    res.on('close', () => abort.abort());

    let stream;
    try {
      stream = await tts.open({ text, lang, speed, sessionId: sessionOf(req) }, abort.signal);
    } catch (err) {
      if (abort.signal.aborted) return;
      if (err instanceof TtsError) return fail(res, err.status, err.code, err.message);
      log(`[tts] failed: ${redact((err as Error).message)}`);
      return fail(res, 502, 'tts_failed', 'Text-to-speech failed.');
    }

    res.status(200);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('X-Audio-Format', 'pcm_s16le');
    res.setHeader('X-Sample-Rate', String(stream.sampleRate));
    res.setHeader('X-TTS-Cache', stream.cache);
    res.setHeader('X-TTS-Model', stream.model);
    res.setHeader('X-TTS-TTFB-Ms', String(stream.ttfbMs));
    res.flushHeaders();

    try {
      for await (const chunk of stream.chunks) {
        if (abort.signal.aborted) break;
        if (!res.write(chunk)) await Promise.race([once(res, 'drain'), once(res, 'close')]);
      }
      if (!abort.signal.aborted) res.end();
    } catch (err) {
      if (!abort.signal.aborted) log(`[tts] stream broke: ${redact((err as Error).message)}`);
      res.destroy(); // the browser sees a broken stream and falls back
    } finally {
      await stream.chunks.return(undefined).catch(() => undefined);
    }
  });

  // ---- usage, friction, metrics ----
  app.post('/api/usage', (req, res) => {
    const seconds = Number(req.body?.sttSeconds);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86_400) return fail(res, 400, 'bad_request', 'sttSeconds must be a number.');
    res.json(usage.setStt(sessionOf(req), seconds));
  });

  app.post('/api/friction', async (req, res) => {
    const b = isObject(req.body) ? req.body : {};
    if (typeof b.text !== 'string' || !b.text.trim() || b.text.length > 1000) return fail(res, 400, 'bad_request', 'text is required.');
    try {
      await friction({
        type: typeof b.type === 'string' ? b.type.slice(0, 40) : 'voice_final',
        screen: typeof b.screen === 'string' ? b.screen.slice(0, 100) : null,
        text: b.text.trim(),
        language: typeof b.language === 'string' ? b.language.slice(0, 8) : 'en',
        confidence: typeof b.confidence === 'number' ? b.confidence : null,
        userId: typeof b.userId === 'string' ? b.userId.slice(0, 100) : 'demo-user',
        sessionId: sessionOf(req),
        source: typeof b.source === 'string' ? b.source.slice(0, 20) : 'voice',
        ts: new Date().toISOString(),
      });
      res.status(204).end();
    } catch (err) {
      log(`[friction] failed: ${(err as Error).message}`);
      fail(res, 500, 'friction_failed', 'Could not log friction.');
    }
  });

  app.post('/api/turn-metrics', async (req, res) => {
    const m = isObject(req.body) ? req.body : {};
    const n = (v: unknown) => (typeof v === 'number' ? `${Math.round(v)}ms` : 'n/a');
    log(`[turn] #${String(m.turnId ?? '?')} stt-final ${n(m.sttFinalMs)} | assistant ${n(m.assistantMs)} | tts-first-byte ${n(m.ttsFirstByteMs)} | first-audio ${n(m.timeToFirstAudioMs)} | cache ${String(m.ttsCache ?? 'n/a')}`);
    try {
      await mkdir(cfg.logDir, { recursive: true });
      await appendFile(path.join(cfg.logDir, 'turns.jsonl'), JSON.stringify({ ...m, sessionId: sessionOf(req), ts: new Date().toISOString() }) + '\n');
    } catch {
      // Metrics are best effort.
    }
    res.status(204).end();
  });

  // ---- test page and built browser module ----
  app.use(express.static(path.join(VOICE_ROOT, 'public')));

  // ---- last-resort error handler: never leak internals or the key ----
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { status?: number })?.status ?? 500;
    log(`[server] ${redact(String((err as Error)?.message ?? err))}`);
    if (!res.headersSent) fail(res, status >= 400 && status < 600 ? status : 500, 'server_error', status === 413 ? 'Request too large.' : 'Something went wrong.');
  });

  return app;
}
