// A frozen card blocks buying, on every path: the Buy screen, Review, Confirm purchase, and anything Icarus sets up.
//
// Three things are guarded, because the backend demo adapter (demo-data.ts) replaces the prototype's own review and
// confirm with versions that never ask the calculator:
//   - calc(...).ok     the amount screen shows the message and dims the button; the voice read-back says nothing
//   - toReview()       refuses to move to Review while frozen
//   - confirm()        refuses while frozen, and only ever runs on the review screen (a stray or repeated call can't buy)
// The design file stays unchanged.
//
// Install it AFTER the demo-data adapter (main.ts): it must be the outermost wrapper.
// It also tells the backend (snapshot.card_frozen) so Icarus can say why, before it fills in a buy.

export const FROZEN_MESSAGE = {
  en: 'Your card is frozen. Unfreeze it to buy.',
  th: 'บัตรของคุณถูกล็อก ปลดล็อกก่อนจึงจะซื้อได้',
} as const;

type Proto = Record<string, any>; // the design runtime exports a dynamic logic class

export function installCardGuard(proto: Proto): void {
  if (proto.__cardGuard) return; // installing twice must not stack wrappers
  proto.__cardGuard = true;
  const message = () => FROZEN_MESSAGE[proto.state?.lang === 'th' ? 'th' : 'en'];
  const frozen = () => Boolean(proto.state?.frozen);
  const calc = proto.calc.bind(proto);
  const getContext = proto.getContext.bind(proto);
  const toReview = proto.toReview?.bind(proto);
  const confirm = proto.confirm?.bind(proto);

  proto.calc = (...args: unknown[]) => {
    const result = calc(...args);
    return frozen() ? { ...result, ok: false, err: message() } : result;
  };
  proto.getContext = () => ({ ...getContext(), card_frozen: frozen() });
  if (toReview) {
    proto.toReview = (...args: unknown[]) => {
      if (frozen()) return proto.toast?.(message());
      return toReview(...args);
    };
  }
  if (confirm) {
    proto.confirm = (...args: unknown[]) => {
      if (frozen()) return proto.toast?.(message());
      if (proto.state?.buyStep !== 'review') return; // only the Review screen can confirm: no stray or repeated buys
      return confirm(...args);
    };
  }
}
