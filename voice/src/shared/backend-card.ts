// Luka and First's trade card (backend/app/tools.py, card_type "trade_preview"), made readable for the money read-back.
// Shared by the voice server's HTTP adapter and the app's backend bridge, so both say the same numbers.

/**
 * Add amount, fee, total and currency to the backend's trade card, so they add up:
 *   buy:  amount = you_pay_thb - fee_thb (what goes into the asset), total = you_pay_thb (what leaves the balance)
 *   sell: amount = amount_thb (value sold), total = you_get_thb (what the user receives)
 * A card that already has these fields, or misses a number, is returned unchanged.
 */
export function withReadbackFields(data: Record<string, unknown>): Record<string, unknown> {
  if ('amount' in data || 'total' in data) return data;
  const num = (k: string) => (typeof data[k] === 'number' && Number.isFinite(data[k]) ? (data[k] as number) : null);
  const cents = (n: number) => Math.round(n * 100) / 100;
  const fee = num('fee_thb');
  if (fee === null || fee < 0) return data;
  // Say "gold", not the card's full name "Tokenized gold (PAX Gold)". The card on screen keeps the full name.
  const spoken = typeof data.asset_id === 'string' && data.asset_id ? { spoken_asset: data.asset_id } : {};
  if (data.side === 'buy') {
    const pay = num('you_pay_thb');
    if (pay === null || pay < fee) return data;
    return { ...data, ...spoken, amount: cents(pay - fee), fee, total: pay, currency: 'THB' };
  }
  if (data.side === 'sell') {
    const sold = num('amount_thb');
    const get = num('you_get_thb');
    if (sold === null || get === null) return data;
    return { ...data, ...spoken, amount: sold, fee, total: get, currency: 'THB' };
  }
  return data;
}
