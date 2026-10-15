// Decides WHAT gets spoken for an assistant reply. Pure function, easy to test.
//
//  - reply.speak is false           -> say nothing.
//  - reply has a money preview card -> say the exact read-back built from the card's numbers.
//                                      The assistant's own sentence is NOT used for money.
//  - card is incomplete             -> say "please check the card", and offer no voice confirm.
//  - anything else                  -> the reply text, cleaned for speech and shortened if long.

import { STRINGS } from '../config/strings';
import { detectLang } from '../shared/lang';
import { buildReadback, findPreviewCard, parsePreview } from '../shared/readback';
import { toSpeakable } from '../shared/speech-format';
import type { AskResponse, AssistantReply, Lang, LangSetting } from '../shared/types';

export function planSpeech(
  reply: AssistantReply,
  requestedLanguage: LangSetting,
  userText: string,
  now?: Date,
): Pick<AskResponse, 'speech' | 'preview'> {
  if (!reply.speak) return { speech: null, preview: null };

  const fallback: Lang = requestedLanguage === 'auto' ? detectLang(userText) : requestedLanguage;
  // The voice follows the language of the reply, so a Thai reply always gets the Thai voice.
  const language = detectLang(reply.text, fallback);

  const card = findPreviewCard(reply);
  if (card) {
    const preview = parsePreview(card);
    if (preview) {
      return { speech: { text: buildReadback(preview, language), language, kind: 'readback' }, preview };
    }
    return {
      speech: { text: STRINGS[language].lines.previewUnreadable, language, kind: 'reply' },
      preview: null,
    };
  }

  const text = toSpeakable(reply.text, { lang: language, ...(now ? { now } : {}) });
  return { speech: text ? { text, language, kind: 'reply' } : null, preview: null };
}
