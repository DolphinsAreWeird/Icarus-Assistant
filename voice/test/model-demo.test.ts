import { expect, it } from 'vitest';
import { normalizeReply } from '../src/server/assistant/http';
import { planSpeech } from '../src/server/speech-plan';

it('keeps model status/evidence and reads the verified numerical script exactly', () => {
  const raw = { text: 'Full explanation and caveats remain on screen.', speech: 'Your simulated account is valued at 1195.37 THB.',
    speech_exact: true, status: 'ok', limitations: ['Simulated account'], numerical_summaries: [{ text: '1195.37 THB' }],
    evidence: [{ source: { delivery: 'snapshot' } }], speak: true, ui_actions: [], sources: [] };
  const reply = normalizeReply(raw);
  expect(reply.status).toBe('ok');
  expect(reply.evidence).toEqual(raw.evidence);
  expect(planSpeech(reply, 'en', 'What is in my account?').speech?.text).toContain('one thousand one hundred ninety-five point three seven');
  expect(planSpeech(reply, 'en', 'What is in my account?').speech?.text).not.toContain('about');
});

it('keeps tap-only trade actions even when a model reply contains a separate script', () => {
  const reply = normalizeReply({ text: 'Review the card.', speech: 'Do not use this script for a purchase.', speech_exact: true,
    ui_actions: [{ type: 'card', card_type: 'trade_preview', data: { preview_id: 'pv', asset_id: 'gold', side: 'buy', amount_thb: 1000, fee_thb: 5, you_pay_thb: 1000 } }] });
  const speech = planSpeech(reply, 'en', 'Put 1000 baht in gold');
  expect(speech.preview).toMatchObject({ amount: 995, fee: 5, total: 1000 });
  expect(speech.speech?.text).toContain('Total one thousand baht');
  expect(reply.ui_actions.every(a => !String(a.type).includes('confirm'))).toBe(true);
});
