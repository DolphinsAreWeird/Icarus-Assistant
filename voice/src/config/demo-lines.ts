// The demo lines. `npm run pregenerate` turns these into audio files in demo-audio/ so the
// demo works with no network and costs credits only once.
//
// Rule: the text here must be the EXACT text that reaches the speaker at runtime.
// English numbers are spoken as words (see shared/readback.ts), so "2.3%" and "1,015" appear as
// "two point three percent" and "one thousand fifteen" below. The `written` field is what the
// screen shows.
// A test (test/demo-lines.test.ts) checks that the mock assistant and the read-back
// builder produce these same strings, so the cache is hit on stage.

import type { Lang } from '../shared/types';

export interface DemoLine {
  id: string;
  lang: Lang;
  /** Exactly what is spoken. */
  text: string;
  /** When Icarus says it. */
  when: string;
  /** What the screen shows, if it differs from what is spoken. */
  written?: string;
}

export const DEMO_LINES_EN: DemoLine[] = [
  { id: 'greeting', lang: 'en', when: 'Panel opens', text: "Hi, I'm Icarus. Ask me about anything on your screen." },
  { id: 'explain', lang: 'en', when: 'Tap the red number', text: "That red number is today's change. Gold is down two point three percent since yesterday.", written: "That red number is today's change. Gold is down 2.3% since yesterday." },
  { id: 'navigate', lang: 'en', when: '"Take me to gold"', text: 'Sure, taking you to gold.' },
  { id: 'readback', lang: 'en', when: '"Put 1,000 baht in gold"', text: 'one thousand baht into gold. Fee fifteen baht. Total one thousand fifteen baht. Say confirm or cancel.', written: '1,000 baht into gold. Fee 15 baht. Total 1,015 baht. Say confirm or cancel.' },
  { id: 'confirmed', lang: 'en', when: 'After the user taps confirm', text: 'Confirmed. Your gold purchase is on its way.' },
  { id: 'refusal', lang: 'en', when: '"What should I buy?"', text: "I can't pick investments for you, but I can compare gold and Bitcoin on fees and past ups and downs. Want that?" },
  // Fixed lines from config/strings.ts that the confirm flow speaks.
  { id: 'didnt-catch', lang: 'en', when: 'Confirm not heard clearly', text: "Sorry, I didn't catch that. Say confirm or cancel." },
  { id: 'cancelled', lang: 'en', when: 'User cancels a preview', text: 'Okay, cancelled.' },
];

// THAI REVIEW: write the Thai demo lines here once the Thai teammate has approved the wording.
// Same ids as the English list. They are generated with VOICE_ID_TH and the Thai model.
export const DEMO_LINES_TH: DemoLine[] = [];

export const DEMO_LINES: DemoLine[] = [...DEMO_LINES_EN, ...DEMO_LINES_TH];
