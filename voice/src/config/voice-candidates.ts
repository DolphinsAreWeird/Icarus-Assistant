// The voices we are auditioning for Icarus. The theme is CUTE, so these are bright, higher voices that are still
// made for conversation rather than cartoon characters. Pitches below were measured from each voice's free sample
// (npm run voices). Run `npm run audition` to hear them say OUR lines and to check them objectively.
//
// Library voices work by ID on a paid plan, no need to add them to the account. Results and the reasons for our
// picks (Brittney for English, Malee for Thai) are in README.md, "Choosing the voices".

import type { Lang } from '../shared/types';

export interface VoiceCandidate {
  name: string;
  voiceId: string;
  lang: Lang;
  source: 'premade' | 'library';
  /** Measured pitch of the free sample, in Hz. */
  sampleHz: number;
  note: string;
}

export const CUTE_FINALISTS: VoiceCandidate[] = [
  { name: 'Callie', voiceId: '7YaUDeaStRuoYg3FKsmU', lang: 'en', source: 'library', sampleHz: 254, note: 'Playful, inviting. Cute, conversational.' },
  { name: 'Emma', voiceId: 'pPdl9cQBQq4p6mRkZy2Z', lang: 'en', source: 'library', sampleHz: 296, note: 'Adorable and upbeat. Character style.' },
  { name: 'Brittney', voiceId: 'XiPS9cXxAVbaIWtGDHDh', lang: 'en', source: 'library', sampleHz: 308, note: 'Young, peppy.' },
  { name: 'Jessica', voiceId: 'cgSgspJ2msm6clMCkdW9', lang: 'en', source: 'premade', sampleHz: 219, note: 'Playful, bright, warm. Already on the account.' },
  { name: 'Aom', voiceId: 'nealpwJT5tCyJFKDzEq8', lang: 'th', source: 'library', sampleHz: 250, note: 'Thai. Gentle, confident, smooth.' },
  { name: 'Malee', voiceId: 'mYcpTKg1oj1H5CtzUZNO', lang: 'th', source: 'library', sampleHz: 281, note: 'Thai. Cheerful, bright, lively. Social media energy.' },
  { name: 'Nueng', voiceId: 'RIc0VzgLsI8EhceUkZx4', lang: 'th', source: 'library', sampleHz: 314, note: 'Thai. Cheerful, bright, friendly. Fast and loud.' },
];
