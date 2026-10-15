import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeElevenLabsPort } from '../src/server/fake-elevenlabs';
import { attachFakeStt } from '../src/server/fake-stt';
import { checkSpoken, comparable, resamplePcm16, similarity, spokenNumbers, transcribePcm16k } from '../src/server/transcribe';
import { makeConfig } from './helpers';

describe('comparing what was said with what was heard', () => {
  it('ignores case, punctuation and spaces', () => {
    expect(similarity("Hi, I'm Icarus. Ask me about anything on your screen.", 'hi im icarus ask me about anything on your screen')).toBe(1);
  });

  it('ignores how numbers are written: words on one side, digits on the other', () => {
    expect(similarity('Gold is down two point three percent since yesterday.', 'Gold is down 2.3% since yesterday.')).toBe(1);
    expect(similarity('Total one thousand fifteen baht.', 'Total 1,015 baht.')).toBe(1);
    expect(comparable('ซื้อทอง 1,000 บาท')).toBe('ซื้อทองบาท');
  });

  it('ignores Thai number words too: Scribe writes "หนึ่งพัน" where the line says 1,000', () => {
    expect(similarity('ซื้อทอง 1,000 บาท. ค่าธรรมเนียม 15 บาท. รวมทั้งหมด 1,015 บาท.', 'ซื้อทองหนึ่งพันบาท ค่าธรรมเนียมสิบห้าบาท รวมทั้งหมดหนึ่งพันสิบห้าบาท')).toBe(1);
    expect(similarity('ทองลดลง 2.3 เปอร์เซ็นต์ จากเมื่อวาน', 'ทองลดลง 2.3% จากเมื่อวาน')).toBe(1);
  });

  it('scores a wrong word lower, and nonsense near zero', () => {
    const exact = similarity('That is outside what I can do in this app.', 'That is outside what I can do in this app.');
    const slightly = similarity('That is outside what I can do in this app.', 'That is outside what I can do in the map.');
    const nonsense = similarity('That is outside what I can do in this app.', 'zebra xylophone quartz');
    expect(exact).toBe(1);
    expect(slightly).toBeGreaterThan(0.8);
    expect(slightly).toBeLessThan(1);
    expect(nonsense).toBeLessThan(0.3);
  });

  it('handles empty and Thai text', () => {
    expect(similarity('', '')).toBe(1);
    expect(similarity('hello', '')).toBe(0);
    expect(similarity('พาไปที่ทอง', 'พาไปที่ทอง.')).toBe(1);
    expect(similarity('พาไปที่ทอง', 'ไปที่ทอง')).toBeGreaterThan(0.7);
  });
});

describe('spokenNumbers (were the RIGHT numbers said?)', () => {
  it('reads digits', () => {
    expect(spokenNumbers('ซื้อทอง 1,000 บาท ค่าธรรมเนียม 15 บาท รวม 1,015 บาท')).toEqual([1000, 15, 1015]);
    expect(spokenNumbers('Gold is down 2.3% since yesterday')).toEqual([2.3]);
  });

  it('reads English number words', () => {
    expect(spokenNumbers('Buy gold for one thousand baht. Fee fifteen baht. Total one thousand fifteen baht.')).toEqual([1000, 15, 1015]);
    expect(spokenNumbers('down two point three percent')).toEqual([2.3]);
    expect(spokenNumbers('twenty-one baht and ninety nine')).toEqual([21, 99]);
    expect(spokenNumbers('two hundred and fifty')).toEqual([200, 50]); // "and" splits it. Our lines never use "and" inside a number.
  });

  it('reads Thai number words', () => {
    expect(spokenNumbers('ซื้อทองหนึ่งพันบาท ค่าธรรมเนียมสิบห้าบาท รวมทั้งหมดหนึ่งพันสิบห้าบาท')).toEqual([1000, 15, 1015]);
    expect(spokenNumbers('ยี่สิบเอ็ดบาท')).toEqual([21]);
    expect(spokenNumbers('สองพันห้าร้อยบาท')).toEqual([2500]);
    expect(spokenNumbers('สิบบาท')).toEqual([10]);
  });

  it('finds nothing in a line with no numbers, and tells a wrong amount from a right one', () => {
    expect(spokenNumbers('สวัสดี ฉันชื่ออิคารัส ถามฉันเรื่องอะไรก็ได้บนหน้าจอของคุณ')).toEqual([]);
    expect(spokenNumbers('Hi, I am Icarus.')).toEqual([]);
    expect(spokenNumbers('Total one thousand two hundred fifteen baht')).not.toEqual(spokenNumbers('Total 1,015 baht'));
  });

  it('matches across the two ways of writing a number (the check the audition does)', () => {
    expect(spokenNumbers('รวมทั้งหมดหนึ่งพันสิบห้าบาท')).toEqual(spokenNumbers('รวมทั้งหมด 1,015 บาท'));
  });
});

describe('resamplePcm16', () => {
  const tone = (hz: number, rate: number, seconds: number) => {
    const samples = new Int16Array(Math.round(rate * seconds));
    for (let i = 0; i < samples.length; i++) samples[i] = Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 8000);
    return new Uint8Array(samples.buffer);
  };

  // A tone crosses zero twice per cycle, so a 220 Hz tone has about 440 crossings a second at ANY sample rate.
  const zeroCrossings = (pcm: Uint8Array) => {
    const s = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
    let n = 0;
    for (let i = 1; i < s.length; i++) if ((s[i - 1] as number) < 0 !== (s[i] as number) < 0) n++;
    return n;
  };

  it('turns 24 kHz into 16 kHz: two thirds of the samples, same pitch', () => {
    const out = resamplePcm16(tone(220, 24000, 1), 24000, 16000);
    expect(out.byteLength / 2).toBe(16000);
    expect(zeroCrossings(out)).toBeGreaterThan(434);
    expect(zeroCrossings(out)).toBeLessThan(446);
  });

  it('copes with an odd byte offset and an odd length (a slice of a WAV file), and leaves equal rates alone', () => {
    const file = new Uint8Array(1 + 4800 * 2 + 1);
    file.set(tone(300, 24000, 0.2), 1);
    const out = resamplePcm16(file.subarray(1), 24000, 16000);
    expect(out.byteLength / 2).toBe(3200);
    expect(resamplePcm16(tone(300, 16000, 0.1), 16000, 16000).byteLength).toBe(3200);
  });
});

describe('transcribePcm16k (against the fake Scribe)', () => {
  let server: Server;
  afterEach(() => new Promise<void>((r) => { server?.closeAllConnections(); server?.close(() => r()); }));

  it('streams speech and returns what Scribe committed', async () => {
    server = createServer();
    attachFakeStt(server);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as AddressInfo).port;
    const cfg = makeConfig({ ELEVENLABS_WS_BASE_URL: `ws://127.0.0.1:${port}` });
    const speech = new Uint8Array(16000 * 2); // 1 s of a loud tone
    const view = new DataView(speech.buffer);
    for (let i = 0; i < 16000; i++) view.setInt16(i * 2, Math.round(Math.sin(i / 8) * 9000), true);
    const heard = await transcribePcm16k(createFakeElevenLabsPort(), cfg, speech, 'en', { leadSilenceSec: 0.2, tailSilenceSec: 3, settleSec: 0.8 });
    expect(heard).toBe("what's this red number"); // the fake's first scripted phrase
  }, 15_000);

  it('keeps listening after the first sentence, so the LAST sentence is not lost (it used to be)', async () => {
    server = createServer();
    attachFakeStt(server);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as AddressInfo).port;
    const cfg = makeConfig({ ELEVENLABS_WS_BASE_URL: `ws://127.0.0.1:${port}` });
    // Two phrases with a pause between them: 0.5 s loud, 1 s quiet, 0.5 s loud, then the clip ends.
    const clip = new Uint8Array(16000 * 2 * 2);
    const view = new DataView(clip.buffer);
    const loud = (from: number, to: number) => {
      for (let i = Math.round(from * 16000); i < Math.round(to * 16000); i++) view.setInt16(i * 2, Math.round(Math.sin(i / 8) * 9000), true);
    };
    loud(0, 0.5);
    loud(1.5, 2);
    const heard = await transcribePcm16k(createFakeElevenLabsPort(), cfg, clip, 'en', { leadSilenceSec: 0.2, tailSilenceSec: 4, settleSec: 0.8 });
    expect(heard).toBe("what's this red number take me to gold");
  }, 20_000);

  it('checkSpoken says whether the amount was right, not just whether the words were', async () => {
    server = createServer();
    // The fake "hears" a wrong total first, then the right one.
    attachFakeStt(server, { scriptEn: ['total one thousand two hundred fifteen baht', 'total one thousand fifteen baht'] });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as AddressInfo).port;
    const cfg = makeConfig({ ELEVENLABS_WS_BASE_URL: `ws://127.0.0.1:${port}` });
    const speech = new Uint8Array(16000);
    const view = new DataView(speech.buffer);
    for (let i = 0; i < 8000; i++) view.setInt16(i * 2, Math.round(Math.sin(i / 8) * 9000), true);
    const opts = { leadSilenceSec: 0.2, tailSilenceSec: 3, settleSec: 0.6 };
    const wrong = await checkSpoken(createFakeElevenLabsPort(), cfg, speech, 'en', 'Total one thousand fifteen baht.', opts);
    expect(wrong.numbersRight).toBe(false);
    expect(wrong.match).toBe(1); // the WORDS match, so only the number check catches it
    const right = await checkSpoken(createFakeElevenLabsPort(), cfg, speech, 'en', 'Total one thousand fifteen baht.', opts);
    expect(right.numbersRight).toBe(true);
    const noNumbers = await checkSpoken(createFakeElevenLabsPort(), cfg, speech, 'en', 'Hello there.', opts);
    expect(noNumbers.numbersRight).toBeUndefined();
  }, 30_000);
});
