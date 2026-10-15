import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { UTOPIA_GLOSSARY } from '../src/config/utopia-glossary';
import { loadConfig } from '../src/server/env';
import { HttpUtopiaKnowledge, MockUtopiaKnowledge, type UtopiaKnowledge } from '../src/server/utopia/knowledge';
import { createUtopia } from '../src/server/utopia';
import { classify, findDefinition, looksLikeRequest, mentionsUtopia } from '../src/server/utopia/router';
import { checkAnswerSafe } from '../src/server/utopia/safety';
import { UtopiaService } from '../src/server/utopia/service';
import { makeConfig } from './helpers';

const kind = (text: string) => classify(text).kind;

describe('router: what kind of request is it?', () => {
  it('spots questions about the U-topia world', () => {
    for (const q of ['What is U-Coin?', "what's u coin", 'tell me about U-Pay', 'How do I get a U-Card', 'ยูคอยน์คืออะไร', 'Is U-center free', 'what is U-Bot']) {
      expect(kind(q), q).toBe('utopia');
    }
  });

  it('sends travel, rides and groceries to the commerce handoff', () => {
    for (const q of ['book me a flight to Phuket', 'I need a hotel in Chiang Mai', 'call me an Uber', 'order me groceries', 'order missing ingredients for pasta', 'จองโรงแรมที่ภูเก็ต', 'เรียกแท็กซี่']) {
      expect(kind(q), q).toBe('commerce');
    }
  });

  it('sends non-finance tasks to the general handoff', () => {
    for (const q of ['draw me a picture of a cat', 'write me a poem about the sea', "what's the weather today", 'build me an app', 'translate this for me', 'วาดรูปแมว']) {
      expect(kind(q), q).toBe('general');
    }
  });

  it('leaves normal in-app requests alone', () => {
    for (const q of ['show me gold', 'put 1,000 baht in gold', 'what does this chart mean', 'switch to one year', 'freeze my card', 'buy 500 baht of bitcoin', 'what is the fee', 'ดูราคาทองคำ', 'ลงทุนทองคำ 1,000 บาท']) {
      expect(kind(q), q).toBe('none');
    }
  });

  it('NEVER hands advice to another bot (hard rule 1)', () => {
    for (const q of [
      'What should I buy?',
      'Should I buy U-Coin?',
      'should I invest in airline stocks',
      'Which is the best investment, gold or bitcoin?',
      'Is it a good time to buy gold?',
      'Should I stake my U-Coin',
      'ควรซื้ออะไรดี',
      'แนะนำเหรียญหน่อย',
    ]) {
      expect(kind(q), q).toBe('none');
    }
  });

  it('still hands off a recommendation that is not about investing', () => {
    expect(kind('recommend a hotel in Phuket')).toBe('commerce');
  });
});

describe('definitions: the glossary only DEFINES things', () => {
  const id = (q: string) => findDefinition(q)?.id ?? null;

  it('answers "what is X" in its many forms', () => {
    expect(id('What is U-Coin?')).toBe('u-coin');
    expect(id("what's u coin")).toBe('u-coin');
    expect(id('tell me about U-Pay')).toBe('u-pay');
    expect(id('explain the U-Card')).toBe('u-card');
    expect(id('what does U-Pay do')).toBe('u-pay');
    expect(id('Who is Topi AI')).toBe('topi-ai');
    expect(id('define U-center')).toBe('u-center');
    expect(id('U-Coin?')).toBe('u-coin'); // just the name
  });

  it('picks the most specific name', () => {
    expect(id('What is U-topia Pay?')).toBe('u-topia-pay');
    expect(id('What is U-topia?')).toBe('u-topia');
  });

  it('understands Thai', () => {
    expect(id('ยูคอยน์คืออะไร')).toBe('u-coin');
    expect(id('อธิบายยูเพย์ให้หน่อย')).toBe('u-pay');
    expect(id('ยูการ์ดคือ')).toBe('u-card');
  });

  it('does NOT answer a different question with a generic definition', () => {
    for (const q of ['How do I buy U-Coin?', 'What are the fees on U-Pay?', 'my U-Card payment failed', 'Can I use U-Wallet in Japan', 'Is U-center free', 'When does U-Coin unlock']) {
      expect(mentionsUtopia(q), q).toBe(true);
      expect(id(q), q).toBeNull();
    }
  });

  it('knows a real request from a misheard word', () => {
    expect(looksLikeRequest('can you check the train times to Hua Hin')).toBe(true);
    expect(looksLikeRequest('uh gold')).toBe(false);
    expect(looksLikeRequest('ช่วยหาเที่ยวบินไปเชียงใหม่ให้หน่อย')).toBe(true);
    expect(looksLikeRequest('ทอง')).toBe(false);
  });
});

describe('the mock glossary obeys the hard rules (a failing test here blocks bad content)', () => {
  it('has unique ids, and both languages for every entry', () => {
    const ids = UTOPIA_GLOSSARY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of UTOPIA_GLOSSARY) {
      expect(e.terms.length, e.id).toBeGreaterThan(0);
      expect(e.en.length, e.id).toBeGreaterThan(10);
      expect(e.th.length, e.id).toBeGreaterThan(5);
    }
  });

  it('every answer passes the safety check: no numbers, no advice (rules 1 and 3)', () => {
    for (const e of UTOPIA_GLOSSARY) {
      expect(checkAnswerSafe(e.en), `${e.id} en`).toEqual({ ok: true });
      expect(checkAnswerSafe(e.th), `${e.id} th`).toEqual({ ok: true });
    }
  });

  it('says where each fact comes from, and nothing claims to be verified yet', () => {
    for (const e of UTOPIA_GLOSSARY) {
      expect(e.evidence.length, e.id).toBeGreaterThan(10);
      if (e.verified) {
        expect(e.checkedBy, `${e.id} needs checkedBy`).toBeTruthy();
        expect(e.checkedOn, `${e.id} needs checkedOn`).toBeTruthy();
      }
    }
    expect(UTOPIA_GLOSSARY.every((e) => !e.verified)).toBe(true);
  });

  it('is short and plain: at most two sentences, no em dashes', () => {
    for (const e of UTOPIA_GLOSSARY) {
      expect(e.en.split(/(?<=[.!?])\s+/).length, e.id).toBeLessThanOrEqual(2);
      expect(`${e.en}${e.th}`, e.id).not.toMatch(/[–—]/);
    }
  });

  it('every entry can be found by asking "What is <its name>?"', () => {
    for (const e of UTOPIA_GLOSSARY) {
      for (const term of e.terms) {
        const question = /[฀-๿]/.test(term) ? `${term}คืออะไร` : `What is ${term}?`;
        expect(findDefinition(question)?.id, question).toBe(e.id);
      }
    }
  });
});

describe('safety screen for words we did not write', () => {
  it('lets plain text through', () => {
    expect(checkAnswerSafe('U-Coin is the native token of the ecosystem.')).toEqual({ ok: true });
    expect(checkAnswerSafe('ยูคอยน์คือโทเคนของระบบ')).toEqual({ ok: true });
  });
  it('blocks numbers, money and percentages (rule 3)', () => {
    for (const t of ['The fee is 1%', 'It costs $5', 'about 1,000 baht', 'Rewards are ten percent', 'ค่าธรรมเนียม 15 บาท', 'rate of 3.5', '฿20']) {
      expect(checkAnswerSafe(t), t).toMatchObject({ ok: false, reason: 'numbers' });
    }
  });
  it('blocks advice and guarantees (rule 1)', () => {
    for (const t of ['You should buy U-Coin now', 'I recommend you buy gold', 'Guaranteed returns every week', 'It is risk-free', 'ควรซื้อยูคอยน์']) {
      expect(checkAnswerSafe(t), t).toMatchObject({ ok: false, reason: 'advice' });
    }
  });
  it('blocks empty and very long text', () => {
    expect(checkAnswerSafe('   ')).toMatchObject({ ok: false, reason: 'empty' });
    expect(checkAnswerSafe('word '.repeat(300))).toMatchObject({ ok: false, reason: 'too_long' });
  });
});

describe('UtopiaService with the mock glossary', () => {
  const svc = (k: UtopiaKnowledge = new MockUtopiaKnowledge(), url = 'https://u.bot/') => new UtopiaService(k, url);

  it('answers a definition, marked as mock and not verified', async () => {
    const r = await svc().route('What is U-Coin?', 'en');
    expect(r).toMatchObject({ kind: 'answer', source: 'mock', verified: false, topic: 'u-coin', language: 'en' });
    expect(r.kind === 'answer' && r.answer).toBe('U-Coin is the native token of the U-topia ecosystem.');
  });

  it('answers in Thai, and in auto mode picks the language from the question', async () => {
    const th = await svc().route('ยูคอยน์คืออะไร', 'auto');
    expect(th).toMatchObject({ kind: 'answer', language: 'th' });
    expect(th.kind === 'answer' && th.answer).toContain('ยูคอยน์');
  });

  it('hands a specific U-topia question to U-Bot instead of guessing', async () => {
    const r = await svc().route('How do I buy U-Coin?', 'en');
    expect(r).toMatchObject({ kind: 'handoff', handoff: { target: 'u-bot', reason: 'utopia_question', url: 'https://u.bot/', question: 'How do I buy U-Coin?', label: 'Open U-Bot' } });
  });

  it('hands off travel, groceries and other tasks', async () => {
    const flight = await svc().route('book me a flight to Phuket', 'en');
    expect(flight).toMatchObject({ kind: 'handoff', handoff: { reason: 'commerce' } });
    expect(flight.kind === 'handoff' && flight.handoff.message).toContain('U-topia Pay');
    expect(await svc().route('draw me a cat', 'en')).toMatchObject({ kind: 'handoff', handoff: { reason: 'general' } });
  });

  it('uses the configured U-Bot address', async () => {
    const r = await svc(new MockUtopiaKnowledge(), 'https://example.test/ubot').route('order groceries', 'en');
    expect(r.kind === 'handoff' && r.handoff.url).toBe('https://example.test/ubot');
  });

  it('speaks Thai in the handoff', async () => {
    const r = await svc().route('จองโรงแรมที่ภูเก็ต', 'auto');
    expect(r.kind === 'handoff' && r.handoff.label).toBe('เปิด U-Bot');
    expect(r.kind === 'handoff' && /[฀-๿]/.test(r.handoff.message)).toBe(true);
  });

  it('leaves normal requests and advice alone', async () => {
    for (const q of ['show me gold', 'what does this chart mean', 'What should I buy?', 'Should I buy U-Coin?']) {
      expect(await svc().route(q, 'en'), q).toEqual({ kind: 'none' });
    }
  });

  it('on a fallback (Icarus did not understand), a real request gets a handoff and a mishearing does not', async () => {
    const real = await svc().route('can you check the train times to Hua Hin', 'en', { fallback: true });
    expect(real).toMatchObject({ kind: 'handoff', handoff: { reason: 'general' } });
    expect(await svc().route('uh gold', 'en', { fallback: true })).toEqual({ kind: 'none' });
    expect(await svc().route('what should I buy with my savings today', 'en', { fallback: true })).toEqual({ kind: 'none' }); // advice
    expect(await svc().route('can you check the train times to Hua Hin', 'en')).toEqual({ kind: 'none' }); // no fallback flag
  });

  it('survives a knowledge source that crashes', async () => {
    const broken: UtopiaKnowledge = { ask: async () => { throw new Error('boom'); } };
    expect(await svc(broken).route('What is U-Coin?', 'en')).toMatchObject({ kind: 'handoff', handoff: { reason: 'utopia_question' } });
  });

  it('never shows an outside answer that breaks the rules: it hands off instead', async () => {
    const bad = (answer: string): UtopiaKnowledge => ({ ask: async () => ({ answer, source: 'u-bot', verified: true, topic: 'x' }) });
    for (const answer of ['The fee is 1% per swap.', 'You should buy U-Coin now.', '']) {
      expect(await svc(bad(answer)).route('What is U-Coin?', 'en'), answer).toMatchObject({ kind: 'handoff' });
    }
    expect(await svc(bad('It is the ecosystem token.')).route('What is U-Coin?', 'en')).toMatchObject({ kind: 'answer', source: 'u-bot', verified: true });
  });
});

describe('HttpUtopiaKnowledge (for when U-Bot has an API)', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((r) => { server?.closeAllConnections(); server ? server.close(() => r()) : r(); }));

  async function serve(handler: (body: unknown, headers: Record<string, string | string[] | undefined>) => { status?: number; json?: unknown; text?: string; delayMs?: number }) {
    const seen: Array<{ body: unknown; headers: Record<string, string | string[] | undefined> }> = [];
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', async () => {
        const body = raw ? JSON.parse(raw) : null;
        seen.push({ body, headers: req.headers });
        const out = handler(body, req.headers);
        if (out.delayMs) await new Promise((r) => setTimeout(r, out.delayMs));
        res.statusCode = out.status ?? 200;
        res.setHeader('content-type', out.text !== undefined ? 'text/plain' : 'application/json');
        res.end(out.text !== undefined ? out.text : JSON.stringify(out.json ?? {}));
      });
    });
    await new Promise<void>((r) => server!.listen(0, r));
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/ask`, seen };
  }

  it('sends the question the way we propose, and returns the answer', async () => {
    const { url, seen } = await serve(() => ({ json: { answer: 'U-Coin is the ecosystem token.', verified: true } }));
    const k = new HttpUtopiaKnowledge(url, 'secret-token', 2000);
    expect(await k.ask('What is U-Coin?', 'en')).toEqual({ answer: 'U-Coin is the ecosystem token.', source: 'u-bot', verified: true, topic: 'u-bot' });
    expect(seen[0]?.body).toEqual({ question: 'What is U-Coin?', language: 'en', context: 'u-topia' });
    expect(seen[0]?.headers.authorization).toBe('Bearer secret-token');
  });

  it('sends no authorization header without a key, and treats verified as false unless it says true', async () => {
    const { url, seen } = await serve(() => ({ json: { answer: 'Fine.' } }));
    const r = await new HttpUtopiaKnowledge(url, undefined, 2000).ask('What is U-Pay?', 'en');
    expect(r?.verified).toBe(false);
    expect(seen[0]?.headers.authorization).toBeUndefined();
  });

  it('returns null (so the user is handed to U-Bot) on errors, bad JSON, no answer and timeouts', async () => {
    const logs: string[] = [];
    for (const handler of [
      () => ({ status: 500, json: { error: 'down' } }),
      () => ({ text: 'not json' }),
      () => ({ json: {} }),
      () => ({ json: { answer: '   ' } }),
      () => ({ json: { answer: 'slow' }, delayMs: 400 }),
    ]) {
      const { url } = await serve(handler);
      expect(await new HttpUtopiaKnowledge(url, undefined, 150, (l) => logs.push(l)).ask('What is U-Coin?', 'en')).toBeNull();
      await new Promise<void>((r) => { server!.closeAllConnections(); server!.close(() => r()); });
      server = undefined;
    }
    expect(await new HttpUtopiaKnowledge('http://127.0.0.1:1/ask', undefined, 500).ask('x', 'en')).toBeNull(); // nobody there
  });

  it('works end to end through the service, with the safety screen on', async () => {
    const { url } = await serve((body) => ({ json: { answer: (body as { question: string }).question.includes('fee') ? 'The fee is 1%.' : 'It is the ecosystem token.' } }));
    const service = new UtopiaService(new HttpUtopiaKnowledge(url, undefined, 2000));
    expect(await service.route('What is U-Coin?', 'en')).toMatchObject({ kind: 'answer', source: 'u-bot' });
    expect(await service.route('What is the U-Coin fee?', 'en')).toMatchObject({ kind: 'handoff' }); // the answer had a number
  });
});

describe('configuration', () => {
  it('defaults to the mock and to the U-Bot front door', () => {
    const cfg = makeConfig();
    expect(cfg.utopiaMode).toBe('mock');
    expect(cfg.ubotUrl).toBe('https://u.bot/');
  });
  it('switches with one setting, and checks what it needs', () => {
    expect(() => makeConfig({ UTOPIA_MODE: 'banana' })).toThrow(/UTOPIA_MODE/);
    const http = makeConfig({ UTOPIA_MODE: 'http', UTOPIA_URL: 'http://localhost:9/ask', UTOPIA_API_KEY: 'k', UBOT_URL: 'https://example.test/' });
    expect(http).toMatchObject({ utopiaMode: 'http', utopiaUrl: 'http://localhost:9/ask', utopiaApiKey: 'k', ubotUrl: 'https://example.test/' });
    expect(() => createUtopia(makeConfig({ UTOPIA_MODE: 'http' }))).toThrow(/UTOPIA_URL/);
    expect(createUtopia(makeConfig())).toBeInstanceOf(UtopiaService);
  });
});
