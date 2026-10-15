import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AskResponse } from '../src/shared/types';
import { SECRET_KEY, listen, makeStack } from './helpers';

let stack: ReturnType<typeof makeStack>;
let server: Awaited<ReturnType<typeof listen>>;

beforeEach(async () => {
  stack = makeStack();
  server = await listen(stack.app);
});
afterEach(() => server.close());

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${server.base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const ask = async (text: string, language = 'en') => (await (await post('/api/ask', { text, language, userId: 'u1' })).json()) as AskResponse;

describe('/api/ask with the mock assistant', () => {
  it('explains', async () => {
    const r = await ask("what's this red number?");
    expect(r.reply.text).toContain('2.3%');
    expect(r.speech).toEqual({ text: "That red number is today's change. Gold is down two point three percent since yesterday.", language: 'en', kind: 'reply' });
    expect(r.reply.ui_actions[0]).toMatchObject({ type: 'highlight', element_id: 'asset.change24h' });
  });

  it('navigates', async () => {
    const r = await ask('take me to gold');
    expect(r.speech?.text).toBe('Sure, taking you to gold.');
    expect(r.reply.ui_actions).toEqual([{ type: 'navigate', screen: 'asset.gold' }]);
  });

  it('prepares a trade and reads it back from the CARD numbers, not the reply sentence', async () => {
    const r = await ask('put 1,000 baht in gold');
    expect(r.speech).toEqual({
      text: 'one thousand baht into gold. Fee ten baht. Total one thousand ten baht. Say confirm or cancel.',
      language: 'en',
      kind: 'readback',
    });
    expect(r.reply.text).not.toBe(r.speech?.text); // proves the spoken text is not the LLM text
    expect(r.preview).toMatchObject({ amount: 1000, fee: 10, total: 1010, currency: 'THB', side: 'buy' });
  });

  it('reads back whatever amount the user said, exactly', async () => {
    const r = await ask('buy 2,500 baht of bitcoin');
    expect(r.speech?.text).toBe('two thousand five hundred baht into Bitcoin. Fee twenty-five baht. Total two thousand five hundred twenty-five baht. Say confirm or cancel.');
  });

  it('speaks the assistant\'s own `speech` script when it provides one (as in the Oasis prototype)', async () => {
    const s = makeStack();
    const app = (await import('../src/server/app')).createApp({
      cfg: s.cfg, tts: s.tts, port: s.port, usage: s.usage, utopia: s.utopia, friction: () => undefined, log: () => undefined,
      assistant: { ask: async () => ({ text: 'Gold is down \u20bf-2.3% (\u0e3f1,015). Details below.', speech: 'Gold is down about 2 percent today. Want a closer look?', emotion: 'curious', speak: true, ui_actions: [], sources: [] }) },
    });
    const srv = await listen(app);
    const r = (await (await fetch(`${srv.base}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'how is gold', language: 'en' }) })).json()) as AskResponse;
    await srv.close();
    expect(r.speech?.text).toBe('Gold is down about 2 percent today. Want a closer look?');
    expect(r.reply.text).toContain('Details below'); // the screen text is untouched
    expect(r.reply.emotion).toBe('curious'); // passed through for the UI
  });

  it('refuses to pick investments', async () => {
    const r = await ask('what should I buy?');
    expect(r.speech?.text).toMatch(/^I can't pick investments for you/);
    expect(r.preview).toBeNull();
  });

  it('answers in Thai with the Thai voice language', async () => {
    const r = await ask('ซื้อทอง 1,000 บาท', 'th');
    expect(r.speech?.language).toBe('th');
    expect(r.speech?.kind).toBe('readback');
    expect(r.speech?.text).toContain('1,010');
  });

  it('detects the language when set to auto', async () => {
    const r = await ask('ตัวเลขสีแดงคืออะไร', 'auto');
    expect(r.speech?.language).toBe('th');
  });

  it('passes the snapshot through untouched', async () => {
    const seen: unknown[] = [];
    const s = makeStack();
    const app = (await import('../src/server/app')).createApp({
      cfg: s.cfg, tts: s.tts, port: s.port, usage: s.usage, utopia: s.utopia, friction: () => undefined, log: () => undefined,
      assistant: { ask: async (req) => { seen.push(req); return { text: 'ok', speak: false, ui_actions: [], sources: [] }; } },
    });
    const srv = await listen(app);
    const snapshot = { screen: 'asset.gold', visible: ['asset.chart'], nested: { a: [1, 2, 3] } };
    const res = await fetch(`${srv.base}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hi there', language: 'en', snapshot, userId: 'u9' }) });
    expect(((await res.json()) as AskResponse).speech).toBeNull(); // speak:false means silence
    await srv.close();
    expect(seen[0]).toEqual({ text: 'hi there', language: 'en', snapshot, userId: 'u9', sessionId: expect.any(String) });
  });

  it('offers no read-back when the preview card is incomplete', async () => {
    const s = makeStack();
    const app = (await import('../src/server/app')).createApp({
      cfg: s.cfg, tts: s.tts, port: s.port, usage: s.usage, utopia: s.utopia, friction: () => undefined, log: () => undefined,
      assistant: { ask: async () => ({ text: 'Preview ready.', speak: true, sources: [], ui_actions: [{ type: 'show_card', card_type: 'preview', data: { preview_id: 'p', side: 'buy', asset: 'gold', amount: 1000, currency: 'THB' } }] }) },
    });
    const srv = await listen(app);
    const r = (await (await fetch(`${srv.base}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'buy gold', language: 'en' }) })).json()) as AskResponse;
    await srv.close();
    expect(r.preview).toBeNull();
    expect(r.speech).toMatchObject({ kind: 'reply', text: "I can't read that out loud. Please check the card on your screen." });
  });

  it('validates input and survives a failing assistant', async () => {
    expect((await post('/api/ask', { text: '' })).status).toBe(400);
    expect((await post('/api/ask', { text: 'x'.repeat(2001) })).status).toBe(400);
    const s = makeStack();
    const app = (await import('../src/server/app')).createApp({
      cfg: s.cfg, tts: s.tts, port: s.port, usage: s.usage, utopia: s.utopia, friction: () => undefined, log: () => undefined,
      assistant: { ask: async () => { throw new Error('boom ' + SECRET_KEY); } },
    });
    const srv = await listen(app);
    const res = await fetch(`${srv.base}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hello there' }) });
    const text = await res.text();
    await srv.close();
    expect(res.status).toBe(502);
    expect(text).not.toContain('boom');
    expect(text).not.toContain(SECRET_KEY);
  });
});

describe('/api/tts', () => {
  it('streams PCM with the right headers, then serves the repeat from cache', async () => {
    const body = { text: 'Sure, taking you to gold.', language: 'en' };
    const first = await post('/api/tts', body, { 'x-session-id': 'sess1' });
    expect(first.status).toBe(200);
    expect(first.headers.get('x-sample-rate')).toBe('24000');
    expect(first.headers.get('x-audio-format')).toBe('pcm_s16le');
    expect(first.headers.get('x-tts-cache')).toBe('miss');
    expect(first.headers.get('x-tts-model')).toBe('eleven_flash_v2_5');
    const bytes = (await first.arrayBuffer()).byteLength;
    expect(bytes).toBeGreaterThan(1000);
    expect(bytes % 2).toBe(0); // whole 16-bit samples

    const second = await post('/api/tts', body, { 'x-session-id': 'sess1' });
    expect(second.headers.get('x-tts-cache')).toBe('hit');
    expect((await second.arrayBuffer()).byteLength).toBe(bytes);
    expect(stack.requests).toHaveLength(1);
    expect(stack.usage.get('sess1')).toMatchObject({ ttsCharacters: 25, ttsCharactersFromCache: 25 });
  });

  it('stops the upstream request when the browser hangs up', async () => {
    const abort = new AbortController();
    const res = await fetch(`${server.base}/api/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(200), language: 'en' }),
      signal: abort.signal,
    });
    const reader = res.body!.getReader();
    await reader.read();
    abort.abort();
    await new Promise((r) => setTimeout(r, 200));
    // Nothing half-finished was cached.
    const again = await post('/api/tts', { text: 'x'.repeat(200), language: 'en' });
    expect(again.headers.get('x-tts-cache')).toBe('miss');
    await again.arrayBuffer();
  });

  it('returns clear JSON errors', async () => {
    const empty = await post('/api/tts', { text: '' });
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { error: { code: string } }).error.code).toBe('empty_text');
  });
});

describe('/api/scribe-token', () => {
  it('returns a wss URL with a token and keyterms, and never the API key', async () => {
    const res = await post('/api/scribe-token', { language: 'th', mode: 'hands-free' });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(SECRET_KEY);
    const { url, commitStrategy } = JSON.parse(text) as { url: string; commitStrategy: string };
    const u = new URL(url);
    expect(u.protocol).toBe('wss:');
    expect(u.searchParams.get('token')).toBe('fake-token');
    expect(u.searchParams.get('language_code')).toBe('th');
    expect(u.searchParams.getAll('keyterms')).toContain('Icarus');
    expect(commitStrategy).toBe('vad');
  });

  it('uses manual commits for push-to-talk', async () => {
    const r = (await (await post('/api/scribe-token', { language: 'en', mode: 'push-to-talk' })).json()) as { commitStrategy: string };
    expect(r.commitStrategy).toBe('manual');
  });

  it('turns on language detection for auto', async () => {
    const { url } = (await (await post('/api/scribe-token', { language: 'auto' })).json()) as { url: string };
    const q = new URL(url).searchParams;
    expect(q.has('language_code')).toBe(false);
    expect(q.get('include_language_detection')).toBe('true');
  });
});

describe('other endpoints', () => {
  it('health never contains the key', async () => {
    const text = await (await fetch(`${server.base}/api/health`)).text();
    expect(text).not.toContain(SECRET_KEY);
    expect(JSON.parse(text)).toMatchObject({ ok: true, apiKeySet: true, assistant: 'mock' });
  });

  it('tracks STT seconds and logs friction', async () => {
    await post('/api/usage', { sttSeconds: 12.5 }, { 'x-session-id': 'abc12345' });
    expect(stack.usage.get('abc12345').sttSeconds).toBe(12.5);
    expect((await post('/api/usage', { sttSeconds: 'lots' })).status).toBe(400);

    const res = await post('/api/friction', { type: 'voice_final', text: 'what does yield mean', language: 'en', confidence: 0.93, screen: 'asset.gold', userId: 'u1' }, { 'x-session-id': 'abc12345' });
    expect(res.status).toBe(204);
    expect(stack.frictionEvents[0]).toMatchObject({ text: 'what does yield mean', screen: 'asset.gold', sessionId: 'abc12345', confidence: 0.93 });
    expect((await post('/api/friction', { text: '' })).status).toBe(400);
  });

  it('allows cross-origin calls from the frontend', async () => {
    const res = await fetch(`${server.base}/api/health`, { headers: { origin: 'http://localhost:5173' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const pre = await fetch(`${server.base}/api/ask`, { method: 'OPTIONS' });
    expect(pre.status).toBe(204);
  });
});

describe('/api/utopia/route (U-topia questions and handoffs to U-Bot)', () => {
  const route = async (body: unknown) => (await (await post('/api/utopia/route', body)).json()) as Record<string, unknown>;

  it('answers a definition from the mock glossary, clearly marked as mock', async () => {
    expect(await route({ text: 'What is U-Coin?', language: 'en' })).toMatchObject({
      kind: 'answer', source: 'mock', verified: false, topic: 'u-coin', answer: 'U-Coin is the native token of the U-topia ecosystem.',
    });
  });

  it('hands off what Icarus cannot do, with a link to U-Bot and the user\'s own words', async () => {
    const r = await route({ text: 'book me a flight to Phuket', language: 'en' });
    expect(r).toMatchObject({ kind: 'handoff', handoff: { target: 'u-bot', reason: 'commerce', url: 'https://u.bot/', label: 'Open U-Bot', question: 'book me a flight to Phuket' } });
  });

  it('uses the language of the question when asked to auto-detect (the default)', async () => {
    expect(await route({ text: 'ยูคอยน์คืออะไร' })).toMatchObject({ kind: 'answer', language: 'th' });
  });

  it('says none for normal requests and for advice', async () => {
    expect(await route({ text: 'show me gold' })).toEqual({ kind: 'none' });
    expect(await route({ text: 'Should I buy U-Coin?' })).toEqual({ kind: 'none' });
  });

  it('offers a handoff only on a real fallback', async () => {
    expect(await route({ text: 'can you check the train times to Hua Hin', fallback: true })).toMatchObject({ kind: 'handoff' });
    expect(await route({ text: 'can you check the train times to Hua Hin' })).toEqual({ kind: 'none' });
  });

  it('validates the request', async () => {
    expect((await post('/api/utopia/route', { text: '' })).status).toBe(400);
    expect((await post('/api/utopia/route', { text: 'x'.repeat(1001) })).status).toBe(400);
  });

  it('is reported in /api/health', async () => {
    expect(await (await fetch(`${server.base}/api/health`)).json()).toMatchObject({ utopia: 'mock' });
  });
});

describe('the mock assistant: U-topia answers and handoffs', () => {
  it('answers "what is U-Coin" from the glossary and says where it came from', async () => {
    const r = await ask('What is U-Coin?');
    expect(r.reply.text).toBe('U-Coin is the native token of the U-topia ecosystem.');
    expect(r.reply.sources[0]).toMatch(/not verified by U-topia/);
    expect(r.reply.ui_actions).toEqual([]);
    expect(r.speech?.text).toBe('U-Coin is the native token of the You topia ecosystem.'); // "U-topia" is spoken as "You topia"
  });

  it('hands off travel with a handoff action the frontend can show', async () => {
    const r = await ask('book me a flight to Phuket');
    expect(r.reply.ui_actions).toEqual([{ type: 'handoff', target: 'u-bot', reason: 'commerce', label: 'Open U-Bot', url: 'https://u.bot/', question: 'book me a flight to Phuket' }]);
    expect(r.reply.text).toContain('U-Bot can help with travel');
    expect(r.speech?.kind).toBe('reply');
    expect(r.reply.sources).toEqual(['handoff:u-bot']);
  });

  it('answers a Thai definition in Thai', async () => {
    const r = await ask('ยูคอยน์คืออะไร', 'th');
    expect(r.speech?.language).toBe('th');
    expect(r.reply.text).toContain('ยูคอยน์');
  });

  it('still refuses advice itself and never hands it to U-Bot', async () => {
    for (const q of ['what should I buy?', 'Should I buy U-Coin?']) {
      const r = await ask(q);
      expect(r.reply.ui_actions.some((a) => a.type === 'handoff'), q).toBe(false);
    }
    expect((await ask('what should I buy?')).speech?.text).toMatch(/^I can't pick investments for you/);
  });

  it('keeps the normal mock replies working', async () => {
    expect((await ask('take me to gold')).speech?.text).toBe('Sure, taking you to gold.');
    expect((await ask('put 1,000 baht in gold')).preview).toMatchObject({ amount: 1000 });
  });
});
