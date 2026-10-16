import express from 'express';
import { request } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listen, makeStack } from './helpers';
import { VoiceApi } from '../src/client/api';

let backend: Awaited<ReturnType<typeof listen>>;
let server: Awaited<ReturnType<typeof listen>>;
let forwarded: string[];
let accounts: Map<string, number>;
let previews: Map<string, { user_id: string; amount: number }>;

async function startProxy(publicDemo: boolean) {
  const stack = makeStack({ BACKEND_PROXY_URL: backend.base, PUBLIC_DEMO: publicDemo ? '1' : '0' });
  server = await listen(stack.app);
}

// Preserve raw path variants that fetch would normalize before sending them.
async function send(path: string, method = 'POST', body: unknown = {}, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = request(server.base, {
      path, method, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...headers },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

beforeEach(async () => {
  forwarded = [];
  accounts = new Map([['visitor-a', 5000], ['visitor-b', 9000]]);
  previews = new Map();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { forwarded.push(`${req.method} ${req.url}`); next(); });
  // Offline stateful backend stand-in: reset destroys every visitor's state.
  app.post('/demo/reset', (_req, res) => {
    accounts.clear();
    previews.clear();
    res.json({ reset: true });
  });
  app.get('/demo/state/:user', (req, res) => res.json({ cash: accounts.get(req.params.user) }));
  app.get('/prices', (_req, res) => res.json({ source: 'offline' }));
  app.post('/chat', (req, res) => res.json({ text: req.body.text, user_id: req.body.user_id }));
  app.post('/trades/preview', (req, res) => {
    previews.set('pending-b', req.body);
    res.json({ preview_id: 'pending-b', ...req.body });
  });
  app.post('/trades/:id/confirm', (req, res) => {
    const preview = previews.get(req.params.id);
    if (!preview || preview.user_id !== req.body.user_id) return void res.status(404).json({ error: 'preview_not_found' });
    accounts.set(preview.user_id, accounts.get(preview.user_id)! - preview.amount);
    previews.delete(req.params.id);
    res.json({ status: 'executed' });
  });
  backend = await listen(app);
  await startProxy(true);
});

afterEach(async () => {
  await server.close();
  await backend.close();
});

describe('public brain proxy reset boundary', () => {
  it.each([
    '/brain/demo/reset',
    '/brain/demo/reset/',
    '/brain/demo/reset?user_id=visitor-a',
    '/brain/demo/reset/?scope=mine',
    '/brain/demo/%72eset',
    '/brain/%64emo/reset',
    '/brain/demo%2freset',
    '/brain//demo//reset//',
    '/brain/demo/./reset',
    '/brain/other/../demo/reset',
    '/brain/other/%2e%2e/demo/reset',
    '/brain/demo/%2e/reset',
    '/brain/demo%5creset',
    '/brain/DEMO/RESET',
  ])('rejects %s before any backend request', async (path) => {
    const result = await send(path);
    expect(result).toMatchObject({ status: 403, body: { error: { code: 'public_reset_disabled' } } });
    expect(forwarded).toEqual([]);
    expect(accounts.get('visitor-b')).toBe(9000);
  });

  it.each(['GET', 'HEAD', 'PUT', 'DELETE', 'PATCH'])('also blocks %s reset requests', async (method) => {
    expect((await send('/brain/demo/reset/', method)).status).toBe(403);
    expect(forwarded).toEqual([]);
  });

  it('preserves another visitor account and pending preview through an attempted reset', async () => {
    expect((await send('/brain/trades/preview', 'POST', { user_id: 'visitor-b', amount: 1000.49 })).status).toBe(200);
    expect((await send('/brain/demo/reset?user_id=visitor-a', 'POST', { user_id: 'visitor-a' })).status).toBe(403);
    expect((await send('/brain/demo/state/visitor-b', 'GET')).body.cash).toBe(9000);
    expect((await send('/brain/trades/pending-b/confirm', 'POST', { user_id: 'visitor-b' })).body.status).toBe('executed');
    expect((await send('/brain/demo/state/visitor-b', 'GET')).body.cash).toBe(7999.51);
    expect((await send('/brain/demo/state/visitor-a', 'GET')).body.cash).toBe(5000);
    expect(forwarded.some((route) => route.includes('/demo/reset'))).toBe(false);
  });

  it('continues proxying normal reads, chat bodies and query strings', async () => {
    expect((await send('/brain/prices?asset=gold', 'GET')).body).toEqual({ source: 'offline' });
    expect((await send('/brain/chat', 'POST', { text: 'Explain gold', user_id: 'visitor-a' })).body)
      .toEqual({ text: 'Explain gold', user_id: 'visitor-a' });
    expect(forwarded).toEqual(['GET /prices?asset=gold', 'POST /chat']);
  });

  it('keeps local rehearsal global reset available', async () => {
    await server.close();
    await startProxy(false);
    previews.set('pending-b', { user_id: 'visitor-b', amount: 1000 });
    expect(await send('/brain/demo/reset/?rehearsal=1')).toEqual({ status: 200, body: { reset: true } });
    expect(forwarded).toEqual(['POST /demo/reset/?rehearsal=1']);
    expect(accounts.size).toBe(0);
    expect(previews.size).toBe(0);
  });
});


describe('public request budgets with a fake backend', () => {
  it('allows multiple visitors to burst beyond the old shared 40 limit', async () => {
    for (const user_id of ['visitor-a', 'visitor-b', 'visitor-c']) {
      for (let i = 0; i < 25; i++) expect((await send('/brain/chat', 'POST', { user_id })).status).toBe(200);
    }
    expect(forwarded).toHaveLength(75);
  });
  it('limits visitor chat while preserving reads, preview and confirmation', async () => {
    for (let i = 0; i < 30; i++) expect((await send('/brain/chat', 'POST', { user_id: 'visitor-b' })).status).toBe(200);
    expect((await send('/brain/%63hat', 'POST', { user_id: 'visitor-b' })).status).toBe(429);
    expect((await send('/brain/chat', 'POST', { user_id: 'visitor-a' })).status).toBe(200);
    expect((await send('/brain/demo/state/visitor-b', 'GET')).status).toBe(200);
    expect((await send('/brain/trades/preview', 'POST', { user_id: 'visitor-b', amount: 1000.49 })).status).toBe(200);
    expect((await send('/brain/trades/pending-b/confirm', 'POST', { user_id: 'visitor-b' })).body.status).toBe('executed');
    expect(accounts.get('visitor-b')).toBe(7999.51);
  });
  it('caps aggregate chat despite rotating IDs and spoofed forwarded addresses', async () => {
    for (let i = 0; i < 600; i++) {
      expect((await send('/brain/chat', 'POST', { user_id: `visitor-${i}` }, { 'x-forwarded-for': `10.0.${i >> 8}.${i % 256}` })).status).toBe(200);
    }
    expect((await send('/brain/chat', 'POST', { user_id: 'another' }, { 'x-forwarded-for': '203.0.113.9' })).status).toBe(429);
    expect((await send('/brain/prices', 'GET')).status).toBe(200);
    expect((await send('/brain/trades/preview', 'POST', { user_id: 'visitor-b', amount: 5 })).status).toBe(200);
    expect((await send('/brain/trades/pending-b/confirm', 'POST', { user_id: 'visitor-b' })).status).toBe(200);
  }, 15_000);
  it.each(['/brain/%E0%A4%A', '/brain/chat%', '/brain/demo/%zzreset', '/brain/trades/%/confirm'])(
    'refuses malformed percent-encoding %s with 400 before any budget or backend request', async (path) => {
      const result = await send(path, 'POST', { user_id: 'visitor-a' });
      expect(result).toMatchObject({ status: 400, body: { error: { code: 'bad_path' } } });
      expect(forwarded).toEqual([]);
      expect((await send('/brain/chat', 'POST', { user_id: 'visitor-a' })).status).toBe(200);
    });
  it('keeps confirmation available through chat exhaustion for path variants of confirm', async () => {
    for (let i = 0; i < 30; i++) await send('/brain/chat', 'POST', { user_id: 'visitor-b' });
    expect((await send('/brain//chat/', 'POST', { user_id: 'visitor-b' })).status).toBe(429);
    expect((await send('/brain/trades/preview/', 'POST', { user_id: 'visitor-b', amount: 1 })).status).toBe(200);
    expect((await send('/brain/trades/pending-b/confirm?x=1', 'POST', { user_id: 'visitor-b' })).body.status).toBe('executed');
  });
  it('restores allowance at the sliding window boundary', async () => {
    const date = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    try {
      for (let i = 0; i < 30; i++) expect((await send('/brain/chat', 'POST', { user_id: 'visitor-a' })).status).toBe(200);
      expect((await send('/brain/chat', 'POST', { user_id: 'visitor-a' })).status).toBe(429);
      date.mockReturnValue(160_000);
      expect((await send('/brain/chat', 'POST', { user_id: 'visitor-a' })).status).toBe(200);
    } finally { date.mockRestore(); }
  });
});


describe('visitors without a selector on one socket IP', () => {
  it('do not share one small U-topia route bucket', async () => {
    for (let i = 0; i < 45; i++) {
      const res = await fetch(`${server.base}/api/utopia/route`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'What is U-topia?', language: 'en' }),
      });
      expect(res.status).toBe(200);
    }
  });
});

describe('real browser VoiceApi quota selectors', () => {
  it('isolates STT sessions and keeps TTS independent from exhausted STT', async () => {
    const a = new VoiceApi(server.base, 'browser-session-a');
    const b = new VoiceApi(server.base, 'browser-session-b');
    for (let i = 0; i < 12; i++) await a.scribeToken('en', 'hands-free');
    await expect(a.scribeToken('en', 'hands-free')).rejects.toMatchObject({ code: 'slow_down', status: 429 });
    expect((await b.scribeToken('en', 'hands-free')).url).toContain('fake-token');
    const speech = await a.tts({ text: 'Hello.', language: 'en', speed: 1 }, new AbortController().signal);
    expect(speech.sampleRate).toBe(24000);
    await new Response(speech.body).arrayBuffer();
  });
});
