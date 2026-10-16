import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { makeLimiter } from '../src/server/app';

type Call = { status: number; retry?: string };

function caller(middleware: ReturnType<ReturnType<typeof makeLimiter>>) {
  return (o: { id?: string; ip?: string; session?: string; path?: string } = {}): Call => {
    const out: Call = { status: 200 };
    const req = {
      socket: { remoteAddress: o.ip ?? 'same-ip' },
      body: o.id === undefined ? {} : { user_id: o.id },
      path: o.path ?? '/chat',
      header: (name: string) => (name.toLowerCase() === 'x-session-id' ? o.session : undefined),
    } as unknown as Request;
    const res = {
      setHeader: (name: string, value: string) => { if (name === 'Retry-After') out.retry = value; },
      status: (code: number) => { out.status = code; return res; },
      json: () => undefined,
    } as unknown as Response;
    middleware(req, res, () => undefined);
    return out;
  };
}

describe('bounded request budget storage', () => {
  it('keeps active budgets when the visitor table is full, counting new selectors against the IP aggregate only', () => {
    let now = 100_000;
    const limits = makeLimiter(true, () => now, 2);
    const chat = caller(limits('chat', 2, 5));
    expect(chat({ id: 'a' }).status).toBe(200);
    expect(chat({ id: 'b' }).status).toBe(200);
    expect(chat({ id: 'a' }).status).toBe(200);
    // 'a' is still limited: its active window was not cleared to make space.
    expect(chat({ id: 'a' }).status).toBe(429);
    // A new visitor is not locked out by the full table; it shares the IP aggregate (5) instead.
    expect(chat({ id: 'c' }).status).toBe(200);
    expect(chat({ id: 'c' }).status).toBe(200);
    expect(chat({ id: 'c' })).toEqual({ status: 429, retry: '60' });
    now += 60_000;
    expect(chat({ id: 'd' }).status).toBe(200);
    expect(chat({ id: 'd' }).status).toBe(200);
    expect(chat({ id: 'd' }).status).toBe(429);
  });

  it('refuses new socket IPs while the IP table is full and frees them after expiry', () => {
    let now = 100_000;
    const read = caller(makeLimiter(true, () => now, 2)('read', 5));
    expect(read({ id: 'a', ip: 'ip-1' }).status).toBe(200);
    expect(read({ id: 'b', ip: 'ip-2' }).status).toBe(200);
    expect(read({ id: 'c', ip: 'ip-3' })).toEqual({ status: 429, retry: '60' });
    expect(read({ id: 'a', ip: 'ip-1' }).status).toBe(200);
    now += 60_000;
    expect(read({ id: 'c', ip: 'ip-3' }).status).toBe(200);
  });

  it('one client filling the read table cannot lock out a new visitor', () => {
    const read = caller(makeLimiter(true, () => 100_000, 50)('read', 600, 12_000));
    for (let i = 0; i < 60; i++) expect(read({ path: `/demo/state/bot-${i}`, ip: 'attacker' }).status).toBe(200);
    expect(read({ path: '/demo/state/u_new-judge', ip: 'judge' }).status).toBe(200);
  });

  it('does not give requests without a selector one small shared bucket', () => {
    const route = caller(makeLimiter(true, () => 100_000)('route', 40));
    for (let i = 0; i < 100; i++) expect(route({ path: '/api/utopia/route' }).status).toBe(200);
    // The socket-IP aggregate (20x) remains the ceiling.
    for (let i = 100; i < 800; i++) route({ path: '/api/utopia/route' });
    expect(route({ path: '/api/utopia/route' }).status).toBe(429);
  });

  it('separates browser tabs that share a default userId by their session', () => {
    const chat = caller(makeLimiter(true, () => 100_000)('chat', 2));
    expect(chat({ id: 'demo-user', session: 'tab-a' }).status).toBe(200);
    expect(chat({ id: 'demo-user', session: 'tab-a' }).status).toBe(200);
    expect(chat({ id: 'demo-user', session: 'tab-a' }).status).toBe(429);
    expect(chat({ id: 'demo-user', session: 'tab-b' }).status).toBe(200);
  });

  it('Retry-After waits for every exhausted window', () => {
    let now = 100_000;
    const chat = caller(makeLimiter(true, () => now)('chat', 2, 3));
    expect(chat({ id: 'a' }).status).toBe(200); // t=100s, fills IP slot 1
    now += 30_000;
    expect(chat({ id: 'b' }).status).toBe(200); // t=130s
    expect(chat({ id: 'b' }).status).toBe(200); // t=130s: b full until 190s, IP full until 160s
    expect(chat({ id: 'b' })).toEqual({ status: 429, retry: '60' });
    expect(chat({ id: 'c' })).toEqual({ status: 429, retry: '30' });
    now += 30_000;
    expect(chat({ id: 'c' }).status).toBe(200);
  });
});
