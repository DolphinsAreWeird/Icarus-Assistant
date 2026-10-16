// The prompt Icarus writes for the real U-Bot, from the user's request and where they are in the app.
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app';
import { MockAssistant } from '../src/server/assistant/mock';
import { buildUbotPrompt } from '../src/shared/ubot-prompt';
import { listen, makeStack } from './helpers';

describe('buildUbotPrompt', () => {
  it('a ride, a flight, a hotel: what to do, how to pay, and the user\'s own words (details stay intact)', () => {
    expect(buildUbotPrompt('book me a ride to the airport tomorrow at 8', 'commerce', 'en')).toBe(
      'Book me a ride to the airport. Show me a few options with the price and pickup time, then let me review and pay in U-topia Pay.\nMy request: “book me a ride to the airport tomorrow at 8”',
    );
    expect(buildUbotPrompt('find me a flight to phuket', 'commerce', 'en')).toMatch(/^Find me flights to Phuket\. .*review and pay in U-topia Pay\./);
    expect(buildUbotPrompt('a hotel in krabi please', 'commerce', 'en')).toMatch(/^Find me a hotel in Krabi\./);
  });

  it('a question about U-topia starts the way U-Bot\'s own "Ask U-Topia" mode does, and says where the user is', () => {
    expect(buildUbotPrompt('how do I reset my U-Pay PIN', 'utopia_question', 'en', { screen: 'Card screen' })).toBe(
      "[Context: question is about U-Topia] How do I reset my U-Pay PIN? I'm on the Card screen in the U-topia app.",
    );
    expect(buildUbotPrompt('what fees apply here', 'utopia_question', 'en', { screen: 'buy screen for Gold', asset: 'Gold' })).toBe(
      "[Context: question is about U-Topia] What fees apply here? I'm on the buy screen for Gold in the U-topia app.",
    );
  });

  it('a general request is passed as it is; Thai gets Thai', () => {
    expect(buildUbotPrompt('draw me a cat', 'general', 'en')).toBe('Draw me a cat.');
    expect(buildUbotPrompt('เรียกรถไปสนามบิน', 'commerce', 'th')).toBe('ช่วยเรียกรถไปสนามบินให้หน่อย ขอดูตัวเลือกพร้อมราคาและเวลารถมารับ แล้วให้ฉันตรวจสอบและจ่ายใน U-topia Pay\nคำขอของฉัน: “เรียกรถไปสนามบิน”');
    expect(buildUbotPrompt('ยูเพย์คืออะไร', 'utopia_question', 'th', { screen: 'หน้าบัตร' })).toBe('[Context: question is about U-Topia] ยูเพย์คืออะไร ตอนนี้ฉันอยู่ที่หน้าบัตรในแอปยูโทเปีย');
  });

  it('cleans odd input: no line breaks or control characters from the user, length capped, empty stays empty', () => {
    const p = buildUbotPrompt('draw\nme\u0007 a   cat', 'general', 'en');
    expect(p).toBe('Draw me a cat.');
    expect(buildUbotPrompt('x'.repeat(500), 'general', 'en').length).toBeLessThanOrEqual(202);
    expect(buildUbotPrompt('   ', 'general', 'en')).toBe('');
  });
});

describe('POST /api/utopia/route with where the user is', () => {
  it('the handoff carries a prompt that says where the user is; nothing else from the request gets in', async () => {
    const s = makeStack();
    const app = createApp({ cfg: s.cfg, assistant: new MockAssistant(0, s.utopia), utopia: s.utopia, tts: s.tts, port: s.port, usage: s.usage, friction: () => undefined, log: () => undefined });
    const srv = await listen(app);
    try {
      const res = await fetch(`${srv.base}/api/utopia/route`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'How do I reset my U-Pay PIN?', language: 'en', context: { screen: 'Card screen', balance: '28,399 USD', asset: 7 } }),
      });
      const route = (await res.json()) as { kind: string; handoff?: { prompt?: string; url: string } };
      expect(route.kind).toBe('handoff');
      expect(route.handoff?.prompt).toBe("[Context: question is about U-Topia] How do I reset my U-Pay PIN? I'm on the Card screen in the U-topia app.");
      expect(route.handoff?.prompt).not.toContain('28,399');
      expect(route.handoff?.url).toBe('https://u.bot/'); // the real U-Bot by default
    } finally {
      await srv.close();
    }
  });
});
