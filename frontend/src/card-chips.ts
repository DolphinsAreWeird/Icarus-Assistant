// A card you closed can be brought back: a small chip under Icarus's message ("Show the steps again") reopens it.
//
// The chart and steps cards float over the phone, outside the chat, so closing one leaves nothing in the chat to open it
// again. The prototype already shows a row of tap-to-send chips under a reply (its `suggestions`), so each card gets one of
// those. Tapping it does NOT send a message to Icarus: we catch it in the prototype's send() and just show the card again
// from the data we kept. The design file is untouched.
//
// Each chip's text must be unique so the right card comes back, even when two replies carry the same kind of card; an
// invisible zero-width character is added for that. We keep the latest MAX_CARDS cards.

export type CardKind = 'chart' | 'steps';
export type Lang = 'en' | 'th';

const MAX_CARDS = 40;
const ZERO_WIDTH = '​';

export const CHIP_TEXT: Record<CardKind, Record<Lang, string>> = {
  chart: { en: 'Show the chart again', th: 'ดูกราฟอีกครั้ง' },
  steps: { en: 'Show the steps again', th: 'ดูขั้นตอนอีกครั้ง' },
};

type Proto = Record<string, any>; // the design runtime exports a dynamic logic class

export interface CardChips {
  /** Remember a card shown with a reply, and return the text of the chip that brings it back. */
  register(kind: CardKind, data: Record<string, unknown>, lang: Lang): string;
  /** Make tapping such a chip show the card instead of sending a message. */
  install(proto: Proto): void;
}

export function createCardChips(show: Record<CardKind, (data: Record<string, unknown>, lang: Lang) => void>): CardChips {
  const cards = new Map<string, { kind: CardKind; data: Record<string, unknown>; lang: Lang }>();
  let installed: Proto | null = null;

  return {
    register(kind, data, lang) {
      let label = CHIP_TEXT[kind][lang];
      while (cards.has(label)) label += ZERO_WIDTH; // unique, and invisible
      cards.set(label, { kind, data, lang });
      if (cards.size > MAX_CARDS) cards.delete(cards.keys().next().value as string);
      return label;
    },
    install(proto) {
      if (installed === proto) return; // installing twice must not stack wrappers
      installed = proto;
      const send = proto.send.bind(proto);
      proto.send = (text: unknown, ...rest: unknown[]) => {
        const card = typeof text === 'string' ? cards.get(text) : undefined;
        if (!card) return send(text, ...rest);
        proto.log?.('card_reopened', { kind: card.kind });
        try {
          show[card.kind](card.data, card.lang);
        } catch {
          /* a card that can't draw must not break the chat */
        }
      };
    },
  };
}
