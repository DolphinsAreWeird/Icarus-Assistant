// The HTTP server. The browser module talks to these endpoints.
//
//   POST /api/scribe-token   mint a single-use STT token + ready-made wss URL (no API key inside)
//   POST /api/ask            text -> assistant -> reply + what to say out loud
//   POST /api/tts            text -> streamed raw PCM audio (cached)
//   POST /api/usage          browser reports STT seconds
//   POST /api/friction       every final transcript goes to the logFriction stub
//   POST /api/turn-metrics   per-turn latency numbers
//   GET  /api/health         what is configured (never returns the key)
//   *    /brain/*            the backend, when BACKEND_PROXY_URL is set (the hosted demo: one address for everything)
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
import { mountUbotMock, type UbotSessions } from './ubot-mock';
import type { UtopiaService } from './utopia/service';

export interface AppDeps {
  cfg: ServerConfig;
  assistant: Assistant;
  tts: TtsService;
  /** null when there is no API key. STT and TTS then answer 503 with a clear message. */
  port: ElevenLabsPort | null;
  usage: UsageTracker;
  friction: FrictionSink;
  /** Answers about U-topia, and handoffs to U-Bot. */
  utopia: UtopiaService;
  /** Sessions of the U-Bot mock. When given, its routes are served under /mock/ubot. */
  ubotSessions?: UbotSessions;
  log?: (line: string) => void;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Demo fairness only: user/session IDs are selectors, not authenticated identities.
 * Each class has independent bounded visitor and aggregate socket-IP windows.
 * Never clear active counters at capacity. Because any client can rotate selectors, the per-visitor window is
 * fairness only and the socket-IP aggregate is the real ceiling: requests with no selector, or new selectors once
 * the visitor table is full, are counted against the aggregate alone (so one client cannot lock out new visitors
 * by filling the table, and visitors without a selector do not share one small bucket). New socket IPs are still
 * refused while the IP table is full.
 */
export function makeLimiter(enabled: boolean, clock = () => Date.now(), maxEntries = 5000) {
  type Window = { times: number[] };
  const classes = new Map<string, { visitors: Map<string, Window>; ips: Map<string, Window>; swept: number }>();
  return (kind: string, max: number, aggregate = max * 20) => {
    let state = classes.get(kind);
    if (!state) {
      state = { visitors: new Map(), ips: new Map(), swept: 0 };
      classes.set(kind, state);
    }
    const buckets = state;
    return (req: Request, res: Response, next: NextFunction) => {
      if (!enabled) return next();
      const now = clock();
      const trim = (window: Window) => { window.times = window.times.filter(t => now - t < 60_000); };
      // At most one sweep a second, also when the tables are full, so a full table cannot make every request O(n).
      if (now - buckets.swept >= 1000) {
        for (const map of [buckets.visitors, buckets.ips]) {
          for (const [key, window] of map) {
            trim(window);
            if (!window.times.length) map.delete(key);
          }
        }
        buckets.swept = now;
      }
      // Deliberately ignore X-Forwarded-For: the current deployment has no
      // configured trusted proxy boundary. A spoofed header must not buy credits.
      const ip = req.socket.remoteAddress ?? 'unknown';
      const validId = (raw: unknown) => typeof raw === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(raw) ? raw : undefined;
      let pathUser: string | undefined;
      try {
        pathUser = /^\/(?:demo\/state|portfolio)\/([^/]+)\/?$/.exec(decodeURIComponent(req.path))?.[1];
      } catch { /* malformed paths have no path selector */ }
      const user = validId(req.body?.user_id) ?? validId(req.body?.userId) ?? validId(pathUser);
      // The browser tab's session goes into the key too: a shared default userId must not merge every tab's bucket.
      const session = validId(req.header('x-session-id'));
      const key = user === undefined && session === undefined ? undefined : JSON.stringify([ip, user ?? null, session ?? null]);
      const existing = key === undefined ? undefined : buckets.visitors.get(key);
      const visitorWindow = existing ?? (key !== undefined && buckets.visitors.size < maxEntries ? { times: [] } : undefined);
      const ipWindow = buckets.ips.get(ip) ?? (buckets.ips.size < maxEntries ? { times: [] } : undefined);
      const refuse = (retry: number) => {
        res.setHeader('Retry-After', String(retry));
        return void res.status(429).json({ error: { code: 'slow_down', message: 'Too many requests. Please wait before trying again.' } });
      };
      if (!ipWindow) return refuse(60);
      if (visitorWindow) trim(visitorWindow);
      trim(ipWindow);
      const full = [visitorWindow && visitorWindow.times.length >= max ? visitorWindow : undefined,
        ipWindow.times.length >= aggregate ? ipWindow : undefined].filter((w): w is Window => w !== undefined);
      // Wait until every exhausted window has a free slot again.
      if (full.length) return refuse(Math.max(1, ...full.map(w => Math.ceil((w.times[0]! + 60_000 - now) / 1000))));
      ipWindow.times.push(now);
      buckets.ips.set(ip, ipWindow);
      if (key !== undefined && visitorWindow) {
        visitorWindow.times.push(now);
        buckets.visitors.set(key, visitorWindow);
      }
      next();
    };
  };
}

export function createApp(deps: AppDeps): express.Express {
  const { cfg, assistant, tts, port, usage, friction, utopia } = deps;
  const log = deps.log ?? ((l: string) => console.log(l));
  const redact = makeRedactor(cfg.apiKey, cfg.utopiaApiKey);
  const app = express();
  app.disable('x-powered-by');
  // Keep Express's default trust proxy=false; see the socket-IP budget below.
  const limit = makeLimiter(Boolean(cfg.publicDemo));

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
      utopia: cfg.utopiaMode,
      ubot: cfg.ubotMode,
      stt: { commitStrategy: cfg.stt.commitStrategy, vadSilenceSecs: cfg.stt.vadSilenceSecs },
      // Where the app finds the backend on this address (the hosted demo). Absent when it runs elsewhere.
      ...(cfg.backendProxyUrl ? { backend: '/brain' } : {}),
      ...(cfg.publicDemo ? { publicDemo: true } : {}),
    });
  });

  // ---- readiness: the hosted health check. Local fake mode (no BACKEND_PROXY_URL) is ready when this server is. ----
  // With a backend next to this server, it must answer /health quickly, report ready, and run the engine we expect
  // (ASSISTANT_ENGINE, when set). Down, hung or wrong engine -> 503 with a reason. /api/health stays as it was.
  app.get('/api/ready', async (_req, res) => {
    if (!cfg.backendProxyUrl) return void res.json({ ok: true, backend: 'none' });
    const timeoutMs = Number(process.env.BACKEND_READY_TIMEOUT_MS) > 0 ? Number(process.env.BACKEND_READY_TIMEOUT_MS) : 5000;
    const unready = (reason: string, extra: Record<string, unknown> = {}) =>
      void res.status(503).json({ ok: false, reason, ...extra });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const upstream = await fetch(`${cfg.backendProxyUrl}/health`, { signal: controller.signal });
      if (!upstream.ok) return unready('backend_unhealthy', { status: upstream.status });
      const body = await upstream.json() as { ready?: boolean; engine?: string; prices_loaded?: number };
      if (body.ready === false) return unready('backend_not_ready', { engine: body.engine, pricesLoaded: body.prices_loaded });
      const expected = process.env.ASSISTANT_ENGINE;
      if (expected && body.engine !== expected) return unready('backend_wrong_engine', { expected, engine: body.engine });
      res.json({ ok: true, backend: 'ready', engine: body.engine });
    } catch (e) {
      const timedOut = controller.signal.aborted;
      unready(timedOut ? 'backend_timeout' : 'backend_unreachable', timedOut ? { timeoutMs } : {});
    } finally {
      clearTimeout(timer);
    }
  });

  // ---- speech-to-text token ----
  app.post('/api/scribe-token', limit('stt', 12), async (req, res) => {
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
  app.post('/api/ask', limit('chat', 30), async (req, res) => {
    const body = isObject(req.body) ? req.body : {};
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 2000) return fail(res, 400, 'bad_request', 'text is required (up to 2000 characters).');
    const language: LangSetting = ['en', 'th', 'auto'].includes(body.language as string) ? (body.language as LangSetting) : 'en';
    const userId = typeof body.userId === 'string' && body.userId ? body.userId.slice(0, 100) : 'demo-user';
    const snapshot = isObject(body.snapshot) ? (body.snapshot as Snapshot) : undefined;

    const started = performance.now();
    try {
      const reply = await assistant.ask({ text, language, ...(snapshot ? { snapshot } : {}), userId, sessionId: sessionOf(req) });
      const assistantMs = Math.round(performance.now() - started);
      const response: AskResponse = { reply, ...planSpeech(reply, language, text), assistantMs };
      res.json(response);
    } catch (err) {
      log(`[ask] assistant failed: ${redact((err as Error).message)}`);
      fail(res, 502, 'assistant_failed', 'The assistant did not answer.');
    }
  });

  // ---- U-topia questions and handoffs to U-Bot ----
  // Body: { text, language, fallback? }. Reply: { kind: 'answer' | 'handoff' | 'none', ... } (see UtopiaRoute).
  app.post('/api/utopia/route', limit('route', 40), async (req, res) => {
    const body = isObject(req.body) ? req.body : {};
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 1000) return fail(res, 400, 'bad_request', 'text is required (up to 1000 characters).');
    const language: LangSetting = ['en', 'th', 'auto'].includes(body.language as string) ? (body.language as LangSetting) : 'auto';
    try {
      // Where the user is, for the U-Bot prompt: two short strings, nothing personal.
      const ctx = isObject(body.context) ? body.context : {};
      const context = {
        ...(typeof ctx.screen === 'string' && ctx.screen.trim() ? { screen: ctx.screen.trim().slice(0, 60) } : {}),
        ...(typeof ctx.asset === 'string' && ctx.asset.trim() ? { asset: ctx.asset.trim().slice(0, 40) } : {}),
      };
      res.json(await utopia.route(text, language, { fallback: body.fallback === true, context }));
    } catch (err) {
      log(`[utopia] route failed: ${redact((err as Error).message)}`);
      res.json({ kind: 'none' }); // never block the conversation because this helper broke
    }
  });

  // ---- text-to-speech (streamed) ----
  app.post('/api/tts', limit('tts', 60), async (req, res) => {
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

  // ---- the backend (the brain), when it runs next to this server: /brain/x -> BACKEND_PROXY_URL/x ----
  // The hosted demo is one address, so the app needs no backend URL and there is no CORS.
  if (cfg.backendProxyUrl) {
    const target = cfg.backendProxyUrl;
    const brainChat = limit('chat', 30, 600);
    const brainRead = limit('read', 600, 12_000);
    const brainPreview = limit('preview', 60, 1200);
    const brainConfirm = limit('confirm', 120, 2400);
    app.use('/brain', async (req, res) => {
      const hasBody = !['GET', 'HEAD'].includes(req.method) && req.body !== undefined;
      try {
        if (cfg.publicDemo) {
          // Match what the upstream receives: URL normalization, one path decode,
          // and slash/dot segments. Query strings never change route permission.
          let pathname: string;
          try {
            pathname = decodeURIComponent(new URL(target + req.url).pathname);
          } catch {
            // Malformed percent-encoding: refuse before any budget or backend request.
            return fail(res, 400, 'bad_path', 'The request path is not valid.');
          }
          const segments: string[] = [];
          for (const segment of pathname.replace(/\\/g, '/').split('/')) {
            if (segment === '..') segments.pop();
            else if (segment && segment !== '.') segments.push(segment);
          }
          const route = segments.join('/');
          if (/(?:^|\/)demo\/reset$/i.test(route)) {
            return fail(res, 403, 'public_reset_disabled', 'Global demo reset is disabled on the public demo.');
          }
          // Classify the decoded route, so /%63hat still uses chat's budget. Reset/admin is refused above first.
          const budget = ['GET', 'HEAD'].includes(req.method) ? brainRead
            : /(?:^|\/)trades\/[^/]+\/(?:confirm|cancel)$/i.test(route) ? brainConfirm
            : /(?:^|\/)trades\/preview$/i.test(route) ? brainPreview : brainChat;
          let allowed = false;
          budget(req, res, () => { allowed = true; });
          if (!allowed) return;
        }
        const upstream = await fetch(target + req.url, {
          method: req.method,
          headers: hasBody ? { 'content-type': 'application/json' } : {},
          ...(hasBody ? { body: JSON.stringify(req.body) } : {}),
          signal: AbortSignal.timeout(45_000),
        });
        res.status(upstream.status);
        const type = upstream.headers.get('content-type');
        if (type) res.setHeader('Content-Type', type);
        res.setHeader('Cache-Control', 'no-store');
        res.send(Buffer.from(await upstream.arrayBuffer()));
      } catch (err) {
        log(`[brain] ${req.method} ${req.path} failed: ${redact((err as Error).message)}`);
        fail(res, 502, 'backend_unreachable', 'The assistant backend did not answer.');
      }
    });
  }

  // ---- the Icarus app (Oasis's prototype, built from ../frontend) at /app/ ----
  // Same origin as the voice API, so there is no CORS to set up and the mic works on localhost.
  // A stand-in for U-Bot until U-topia shares an API (ubot-mock/index.ts).
  if (deps.ubotSessions) mountUbotMock(app, deps.ubotSessions);

  // The public demo opens on the app. The voice test page stays at /index.html.
  if (cfg.publicDemo) app.get('/', (req, res) => res.redirect(302, '/app/' + (req.originalUrl.match(/\?.*$/)?.[0] ?? '')));

  app.use('/app', express.static(path.join(VOICE_ROOT, '..', 'frontend', 'dist')));

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
