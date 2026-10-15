// The U-Bot mock: sample replies, handoff sessions, its routes, and our proposed "Ask U-topia" API end to end.
import { afterEach, describe, expect, it } from 'vitest';
import { destinationOf, mockKind, mockReply } from '../src/config/ubot-mock';
import { MockAssistant } from '../src/server/assistant/mock';
import { createApp } from '../src/server/app';
import { mockHandoffUrl, UbotSessions } from '../src/server/ubot-mock';
import { createUtopia } from '../src/server/utopia';
import { HttpUtopiaKnowledge } from '../src/server/utopia/knowledge';
import { UtopiaService } from '../src/server/utopia/service';
import { listen, makeConfig, makeStack } from './helpers';

describe('sample replies', () => {
  it('knows what kind of request it is, and where to', () => {
    expect(mockKind('book me a ride to the airport', 'commerce')).toBe('ride');
    expect(mockKind('find me a flight to Phuket', 'commerce')).toBe('flight');
    expect(mockKind('order groceries for the week', 'commerce')).toBe('grocery');
    expect(mockKind('draw me a cat', 'general')).toBe('other');
    expect(destinationOf('book me a ride to the airport')).toBe('the airport');
    expect(destinationOf('a flight to phuket tomorrow please')).toBe('Phuket');
    expect(destinationOf('I want to go to the mall')).toBe('the mall');
    expect(destinationOf('hotels in krabi')).toBe('Krabi');
    expect(destinationOf('book a flight')).toBeNull();
  });

  it('offers sample options for commerce and none for everything else, in the right language', () => {
    const ride = mockReply('book me a ride to the airport', 'commerce', 'en');
    expect(ride.text).toBe('Here are rides to the airport. Pick one, then review and pay in U-topia Pay.');
    expect(ride.options).toHaveLength(3);
    expect(ride.sample).toBe(true);
    expect(mockReply('เรียกรถไปสนามบิน', 'commerce', 'th').text).toContain('ไปสนามบิน');
    expect(mockReply('draw me a cat', 'general', 'en').options).toEqual([]);
    expect(mockReply('What is U-Pay staking?', 'utopia_question', 'en').options).toEqual([]);
  });
});

describe('handoff sessions', () => {
  it('keeps the question on the server and forgets it after an hour', () => {
    let now = 0;
    const sessions = new UbotSessions(() => now);
    const s = sessions.create('book me a ride', 'commerce', 'en');
    expect(s.id).toMatch(/^[0-9a-f]{16}$/);
    expect(sessions.get(s.id)?.question).toBe('book me a ride');
    now = 61 * 60 * 1000;
    expect(sessions.get(s.id)).toBeUndefined();
  });

  it('holds at most a set number, dropping the oldest', () => {
    const sessions = new UbotSessions(() => 0, 3_600_000, 2);
    const a = sessions.create('a', 'general', 'en');
    sessions.create('b', 'general', 'en');
    sessions.create('c', 'general', 'en');
    expect(sessions.get(a.id)).toBeUndefined();
  });

  it('in mock mode a handoff links to the mock page, with a session instead of the question', async () => {
    const sessions = new UbotSessions();
    const utopia = createUtopia(makeConfig({ UBOT_MODE: 'mock' }), () => undefined, sessions);
    const route = await utopia.route('book me a ride to the airport', 'en');
    expect(route.kind).toBe('handoff');
    const handoff = route.kind === 'handoff' ? route.handoff : null;
    expect(handoff?.mock).toBe(true);
    expect(handoff?.url).toMatch(/^\/app\/\?page=ubot&session=[0-9a-f]{16}$/);
    expect(handoff?.url).not.toContain('ride');
    expect(sessions.get(handoff!.url.split('session=')[1]!)?.question).toBe('book me a ride to the airport');
  });

  it('in link mode a handoff goes to the real U-Bot, as before', async () => {
    const utopia = createUtopia(makeConfig({ UBOT_MODE: 'link' }), () => undefined, new UbotSessions());
    const route = await utopia.route('book me a ride to the airport', 'en');
    expect(route.kind === 'handoff' && route.handoff.url).toBe('https://u.bot/');
    expect(route.kind === 'handoff' && route.handoff.mock).toBeUndefined();
  });
});

describe('the mock routes', () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await close?.();
    close = null;
  });

  async function start() {
    const s = makeStack();
    const sessions = new UbotSessions();
    const app = createApp({ cfg: s.cfg, assistant: new MockAssistant(0, s.utopia), utopia: s.utopia, tts: s.tts, port: s.port, usage: s.usage, friction: () => undefined, log: () => undefined, ubotSessions: sessions });
    const srv = await listen(app);
    close = srv.close;
    return { base: srv.base, sessions };
  }
  const post = (url: string, body?: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

  it('hands off, shows the session, and answers with sample options', async () => {
    const { base } = await start();
    const h = (await (await post(`${base}/mock/ubot/handoff`, { question: 'find me a flight to phuket', reason: 'commerce', language: 'en' })).json()) as { session_id: string; url: string };
    expect(h.url).toBe(`/app/?page=ubot&session=${h.session_id}`);
    const session = await (await fetch(`${base}/mock/ubot/session/${h.session_id}`)).json();
    expect(session).toEqual({ question: 'find me a flight to phuket', reason: 'commerce', language: 'en', mock: true });
    const reply = (await (await post(`${base}/mock/ubot/session/${h.session_id}/reply`)).json()) as { kind: string; text: string; options: unknown[] };
    expect(reply.kind).toBe('flight');
    expect(reply.text).toContain('flights to Phuket');
    expect(reply.options.length).toBeGreaterThan(0);
  });

  it('refuses unknown or malformed sessions and empty questions', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/mock/ubot/session/0123456789abcdef`)).status).toBe(404);
    expect((await fetch(`${base}/mock/ubot/session/../../etc`)).status).toBe(404);
    expect((await post(`${base}/mock/ubot/handoff`, { question: '' })).status).toBe(400);
    expect((await post(`${base}/mock/ubot/ask`, {})).status).toBe(400);
  });

  it('serves our proposed "Ask U-topia" API, and the HTTP knowledge source labels its answers as mock', async () => {
    const { base } = await start();
    const knowledge = new HttpUtopiaKnowledge(`${base}/mock/ubot/ask`, undefined, 3000);
    const found = await knowledge.ask('What is U-Coin?', 'en');
    expect(found).toMatchObject({ source: 'mock', verified: false });
    expect(found?.answer).toContain('U-Coin');
    expect(await knowledge.ask('What is the meaning of life?', 'en')).toBeNull();

    // The whole path: UTOPIA_MODE=http pointed at the mock.
    const utopia = new UtopiaService(knowledge);
    const answer = await utopia.route('What is U-Coin?', 'en');
    expect(answer).toMatchObject({ kind: 'answer', source: 'mock', verified: false });
    const unknown = await utopia.route('How do I reset my U-Pay PIN?', 'en');
    expect(unknown.kind).toBe('handoff');
  });
});

describe('mockHandoffUrl', () => {
  it('makes a new session for every handoff', () => {
    const sessions = new UbotSessions();
    const urlFor = mockHandoffUrl(sessions);
    expect(urlFor('a', 'general', 'en')).not.toBe(urlFor('a', 'general', 'en'));
  });
});
