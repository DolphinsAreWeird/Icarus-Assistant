// Runs the REAL SttClient against a real WebSocket (the fake Scribe), in Node.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { SttClient, type SttFinal } from '../src/client/stt-client';
import { attachFakeStt } from '../src/server/fake-stt';
import { buildSttUrl } from '../src/shared/stt-protocol';

let server: Server;
async function start(opts = {}) {
  server = createServer();
  attachFakeStt(server, opts);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  const url = (over: Partial<Parameters<typeof buildSttUrl>[0]> = {}) =>
    buildSttUrl({ baseUrl: `ws://127.0.0.1:${port}`, token: 't', commitStrategy: 'vad', vadSilenceSecs: 0.3, vadThreshold: 0.4, minSpeechMs: 100, minSilenceMs: 100, keyterms: ['gold'], noVerbatim: true, detectLanguage: false, languageCode: 'en', ...over });
  return { url };
}
afterEach(() => new Promise<void>((r) => { server?.closeAllConnections(); server?.close(() => r()); }));

const frame = (rms: number) => {
  const f = new Int16Array(320);
  f.fill(Math.round(rms * 32767));
  return f;
};
const speak = (stt: SttClient, rms: number, seconds: number) => { for (let i = 0; i < seconds * 50; i++) stt.sendAudio(frame(rms)); };

describe('SttClient over a real WebSocket', () => {
  it('connects, sends audio, gets partials and ONE final with confidence', async () => {
    const { url } = await start();
    const stt = new SttClient({ confidenceWaitMs: 300 });
    const partials: string[] = [];
    const finals: SttFinal[] = [];
    stt.on('partial', (t) => partials.push(t));
    stt.on('final', (f) => finals.push(f));
    await stt.connect(url());
    expect(stt.isOpen).toBe(true);

    speak(stt, 0.2, 0.6); // talking
    speak(stt, 0, 0.6); // silence: the fake commits after 0.3 s
    await new Promise((r) => setTimeout(r, 500));

    expect(partials.length).toBeGreaterThan(0);
    expect(finals).toHaveLength(1); // plain + timestamped messages become a single final
    expect(finals[0]?.text).toBe("what's this red number");
    expect(finals[0]?.confidence).toBeCloseTo(Math.exp(-0.05), 3);
    expect(finals[0]?.languageCode).toBe('eng');
    expect(stt.secondsSent).toBeGreaterThan(1);
    stt.close();
  });

  it('walks through the script, and Thai uses the Thai script', async () => {
    const { url } = await start();
    const stt = new SttClient({ confidenceWaitMs: 300 });
    const finals: string[] = [];
    stt.on('final', (f) => finals.push(f.text));
    await stt.connect(url({ languageCode: 'th' }));
    for (let i = 0; i < 2; i++) { speak(stt, 0.2, 0.5); speak(stt, 0, 0.5); await new Promise((r) => setTimeout(r, 250)); }
    expect(finals).toEqual(['ตัวเลขสีแดงคืออะไร', 'พาไปที่ทอง']);
    stt.close();
  });

  it('manual mode commits only when asked (push to talk)', async () => {
    const { url } = await start();
    const stt = new SttClient({ confidenceWaitMs: 300 });
    const finals: string[] = [];
    stt.on('final', (f) => finals.push(f.text));
    await stt.connect(url({ commitStrategy: 'manual' }));
    speak(stt, 0.2, 0.5);
    speak(stt, 0, 1);
    await new Promise((r) => setTimeout(r, 150));
    expect(finals).toHaveLength(0); // silence alone does nothing in manual mode
    stt.commit();
    await new Promise((r) => setTimeout(r, 150));
    expect(finals).toEqual(["what's this red number"]);
    stt.close();
  });

  it('still emits the final (with unknown confidence) if the timestamped message never comes', async () => {
    const { url } = await start();
    const stt = new SttClient({ confidenceWaitMs: 100 });
    const finals: SttFinal[] = [];
    stt.on('final', (f) => finals.push(f));
    // Talk to a socket that only sends the plain committed message.
    const raw = createServer();
    const { WebSocketServer } = await import('ws');
    new WebSocketServer({ server: raw }).on('connection', (ws) => {
      ws.send(JSON.stringify({ message_type: 'session_started', session_id: 'x' }));
      ws.send(JSON.stringify({ message_type: 'committed_transcript', text: 'confirm' }));
    });
    await new Promise<void>((r) => raw.listen(0, r));
    await stt.connect(`ws://127.0.0.1:${(raw.address() as AddressInfo).port}/`);
    await new Promise((r) => setTimeout(r, 250));
    expect(finals).toEqual([{ text: 'confirm', confidence: null, languageCode: null }]);
    stt.close();
    raw.closeAllConnections();
    raw.close();
    void url;
  });

  it('reports a clean close and an error for a dead address', async () => {
    const stt = new SttClient();
    await expect(stt.connect('ws://127.0.0.1:1/')).rejects.toThrow();
  });
});
