// The U-Bot mock page (?page=ubot&session=<id>) and the handoff card in mock mode.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hideHandoffCard, showHandoffCard } from '../src/handoff-card';
import { renderUbotMock } from '../src/ubot-mock';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;

const SESSION = { question: 'book me a ride to the airport', reason: 'commerce', language: 'en', mock: true };
const REPLY = {
  kind: 'ride',
  text: 'Here are rides to the airport. Pick one, then review and pay in U-topia Pay.',
  options: [
    { title: 'Economy car', detail: '4 seats', priceThb: 420 },
    { title: 'Van', detail: '6 seats', priceThb: 690 },
  ],
  sample: true,
};

function fakeServer(session: unknown = SESSION, reply: unknown = REPLY) {
  return vi.fn(async (url: string) => {
    if (url.endsWith('/reply')) return json(200, reply);
    return session ? json(200, session) : json(404, { error: { code: 'session_not_found' } });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  document.body.innerHTML = '';
  hideHandoffCard();
});

describe('the U-Bot mock page', () => {
  it('carries the question over, says it is a mock, and offers sample options', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await renderUbotMock(root, { sessionId: 'abcdef0123456789', fetchImpl: fakeServer() });
    const text = root.textContent ?? '';
    expect(text).toContain('MOCK');
    expect(text).toContain('options and prices are samples');
    expect(text).toContain('From Icarus');
    expect(text).toContain('book me a ride to the airport');
    expect(text).toContain('Here are rides to the airport.');
    expect(text).toContain('฿420');
    expect(text).toContain('sample');
    expect(root.querySelector('input, textarea, select')).toBeNull(); // never asks for payment details
  });

  it('review and pay in U-topia Pay: a mock step that says nothing moved', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await renderUbotMock(root, { sessionId: 'abcdef0123456789', fetchImpl: fakeServer() });
    const van = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes('Van'))!;
    van.click();
    const review = root.querySelector('[data-testid="ubot-review"]')!;
    expect(review.textContent).toContain('Review & pay in U-topia Pay');
    expect(review.textContent).toContain('Total (sample)฿690');
    expect(review.textContent).toContain('nothing is booked and no money moves');
    (Array.from(review.querySelectorAll('button')).find((b) => b.textContent?.includes('Pay with U-topia Pay (mock)')) as HTMLButtonElement).click();
    expect(review.textContent).toContain('Done, in the mock.');
  });

  it('speaks Thai when the handoff was in Thai', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await renderUbotMock(root, { sessionId: 'abcdef0123456789', fetchImpl: fakeServer({ ...SESSION, question: 'เรียกรถไปสนามบิน', language: 'th' }) });
    expect(root.textContent).toContain('นี่คือ U-Bot จำลอง');
    expect(root.textContent).toContain('จาก Icarus');
  });

  it('says so when the handoff has expired or the server is down', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await renderUbotMock(root, { sessionId: 'abcdef0123456789', fetchImpl: fakeServer(null) });
    expect(root.textContent).toContain('This handoff has expired. Ask Icarus again.');
    const down = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    await renderUbotMock(root, { sessionId: 'abcdef0123456789', fetchImpl: down });
    expect(root.textContent).toContain("can't be reached");
  });

  it('for something it cannot do, points to the real U-Bot', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await renderUbotMock(root, { sessionId: 'abcdef0123456789', fetchImpl: fakeServer({ ...SESSION, reason: 'general' }, { kind: 'other', text: "The real U-Bot would take it from here. This mock can't do that part yet.", options: [], sample: true }) });
    await sleep(0);
    const real = Array.from(root.querySelectorAll('a')).find((a) => a.href === 'https://u.bot/')!;
    expect(real.textContent).toContain('Open the real U-Bot');
    expect(real.target).toBe('_blank');
  });
});

describe('the handoff card in mock mode', () => {
  it('says it opens the mock with the question, and drops "copy my question"', () => {
    const card = showHandoffCard(
      { label: 'Open U-Bot', message: 'm', url: '/app/?page=ubot&session=abcdef0123456789', question: 'book me a ride', reason: 'commerce', mock: true },
      { th: false, getPhone: () => null },
    );
    expect(card.textContent).toContain('Opens the U-Bot mock in a new tab, with your question.');
    expect(card.textContent).not.toContain('Copy my question');
    expect(card.querySelector('a')?.getAttribute('href')).toBe('/app/?page=ubot&session=abcdef0123456789');
  });

  it('without mock, it is the real U-Bot as before', () => {
    const card = showHandoffCard({ label: 'Open U-Bot', message: 'm', url: 'https://u.bot/', question: 'q', reason: 'commerce' }, { th: false, getPhone: () => null });
    expect(card.textContent).toContain('You need to sign in there.');
    expect(card.textContent).toContain('Copy my question');
  });
});
