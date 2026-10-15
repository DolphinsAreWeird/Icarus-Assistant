// The demo audio is only useful if the text matches what actually reaches the speaker.
import { describe, expect, it } from 'vitest';
import { DEMO_LINES_EN } from '../src/config/demo-lines';
import { MockAssistant } from '../src/server/assistant/mock';
import { planSpeech } from '../src/server/speech-plan';
import { STRINGS } from '../src/config/strings';

const line = (id: string) => DEMO_LINES_EN.find((l) => l.id === id)!.text;
const mock = new MockAssistant(0);
const spoken = async (text: string) => {
  const reply = await mock.ask({ text, language: 'en', userId: 'u' });
  return planSpeech(reply, 'en', text).speech?.text;
};

describe('demo lines match what the pipeline really says', () => {
  it('explain', async () => expect(await spoken("what's this red number")).toBe(line('explain')));
  it('navigate', async () => expect(await spoken('take me to gold')).toBe(line('navigate')));
  it('read-back', async () => expect(await spoken('put 1,000 baht in gold')).toBe(line('readback')));
  it('refusal', async () => expect(await spoken('what should I buy')).toBe(line('refusal')));
  it('fixed lines', () => {
    expect(line('didnt-catch')).toBe(STRINGS.en.lines.didntCatch);
    expect(line('cancelled')).toBe(STRINGS.en.lines.cancelled);
  });
  it('has no em dashes', () => {
    for (const l of DEMO_LINES_EN) expect(l.text).not.toMatch(/[\u2013\u2014]/);
  });
});
