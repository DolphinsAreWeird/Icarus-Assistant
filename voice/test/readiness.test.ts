import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { listen, makeStack } from './helpers';

const closers: Array<() => void> = [];
afterEach(() => { while (closers.length) closers.pop()!(); delete process.env.ASSISTANT_ENGINE; delete process.env.BACKEND_READY_TIMEOUT_MS; });

async function fakeBackend(handler: express.RequestHandler) {
  const app = express();
  app.get('/health', handler);
  const b = await listen(app);
  closers.push(() => void b.close());
  return b;
}

async function ready(backendUrl: string | undefined) {
  const stack = makeStack(backendUrl ? { BACKEND_PROXY_URL: backendUrl } : {});
  const s = await listen(stack.app);
  closers.push(() => void s.close());
  const r = await fetch(`${s.base}/api/ready`);
  return { status: r.status, body: await r.json() as any };
}

describe('/api/ready', () => {
  it('is ok without a backend (local fake mode)', async () => {
    expect((await ready(undefined)).status).toBe(200);
  });
  it('is ok when the backend is ready', async () => {
    const b = await fakeBackend((_q, r) => void r.json({ ready: true, engine: 'legacy' }));
    const r = await ready(b.base);
    expect(r.status).toBe(200);
    expect(r.body.engine).toBe('legacy');
  });
  it('503 when the backend is down', async () => {
    const probe = createServer(); await new Promise<void>(res => probe.listen(0, '127.0.0.1', res));
    const url = `http://127.0.0.1:${(probe.address() as AddressInfo).port}`;
    await new Promise(res => probe.close(res));
    const r = await ready(url);
    expect(r.status).toBe(503);
    expect(r.body.reason).toBe('backend_unreachable');
  });
  it('503 when the backend hangs', async () => {
    process.env.BACKEND_READY_TIMEOUT_MS = '150';
    const b = await fakeBackend(() => { /* never answers */ });
    const r = await ready(b.base);
    expect(r.status).toBe(503);
    expect(r.body.reason).toBe('backend_timeout');
  });
  it('503 when the backend is not ready or unhealthy', async () => {
    const nr = await fakeBackend((_q, r) => void r.json({ ready: false, engine: 'legacy', prices_loaded: 0 }));
    expect((await ready(nr.base)).body.reason).toBe('backend_not_ready');
    const bad = await fakeBackend((_q, r) => void r.status(500).end());
    expect((await ready(bad.base)).body.reason).toBe('backend_unhealthy');
  });
  it('503 when the engine is not the expected one', async () => {
    process.env.ASSISTANT_ENGINE = 'legacy';
    const b = await fakeBackend((_q, r) => void r.json({ ready: true, engine: 'model' }));
    const r = await ready(b.base);
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ reason: 'backend_wrong_engine', expected: 'legacy', engine: 'model' });
  });
  it('/api/health is unchanged and never calls the backend', async () => {
    const b = await fakeBackend((_q, r) => void r.status(500).end());
    const stack = makeStack({ BACKEND_PROXY_URL: b.base });
    const s = await listen(stack.app); closers.push(() => void s.close());
    const r = await fetch(`${s.base}/api/health`);
    expect(r.status).toBe(200);
    expect((await r.json() as any).ok).toBe(true);
  });
});
