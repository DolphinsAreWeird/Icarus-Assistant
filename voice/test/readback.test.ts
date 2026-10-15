import { describe, expect, it } from 'vitest';
import { DEMO_LINES_EN } from '../src/config/demo-lines';
import { buildReadback, extractPreview, findPreviewCard, parsePreview } from '../src/shared/readback';
import type { AssistantReply, TradePreview } from '../src/shared/types';

const gold: TradePreview = {
  preview_id: 'p1', side: 'buy', asset: 'gold', amount: 1000, fee: 15, total: 1015, currency: 'THB',
};

const replyWith = (data: Record<string, unknown>, card_type = 'preview'): AssistantReply => ({
  text: 'x', speak: true, sources: [], ui_actions: [{ type: 'show_card', card_type, data }],
});

describe('buildReadback', () => {
  it('matches the demo line exactly', () => {
    const line = DEMO_LINES_EN.find((l) => l.id === 'readback')!;
    expect(buildReadback(gold, 'en')).toBe(line.text);
  });

  it('keeps every number exact, never "about"', () => {
    const text = buildReadback({ ...gold, amount: 1234.56, fee: 18.52, total: 1253.08 }, 'en');
    expect(text).toBe('1,234.56 baht into gold. Fee 18.52 baht. Total 1,253.08 baht. Say confirm or cancel.');
    expect(text).not.toMatch(/about|around|roughly/i);
  });

  it('shows two decimals so 1015.5 is never read as 1,015', () => {
    expect(buildReadback({ ...gold, total: 1015.5 }, 'en')).toContain('Total 1,015.50 baht.');
  });

  it('names the asset and currency in words', () => {
    const text = buildReadback({ ...gold, asset: 'Bitcoin', currency: 'USD', amount: 50, fee: 1, total: 51 }, 'en');
    expect(text).toBe('50 dollars into Bitcoin. Fee 1 dollars. Total 51 dollars. Say confirm or cancel.');
  });

  it('reads sells and deposits', () => {
    expect(buildReadback({ ...gold, side: 'sell' }, 'en')).toMatch(/^Selling 1,000 baht of gold\./);
    expect(buildReadback({ ...gold, side: 'deposit' }, 'en')).toMatch(/^Deposit 1,000 baht\./);
  });

  it('builds a Thai read-back with the same exact numbers', () => {
    const text = buildReadback(gold, 'th');
    expect(text).toContain('1,000');
    expect(text).toContain('15');
    expect(text).toContain('1,015');
    expect(text).toContain('ทอง');
    expect(text).toContain('บาท');
    expect(text).toContain('ยืนยัน');
    expect(text).toContain('ยกเลิก');
  });
});

describe('parsePreview', () => {
  const good = { preview_id: 'p1', side: 'buy', asset: 'gold', amount: 1000, fee: 15, total: 1015, currency: 'THB' };

  it('accepts a complete preview', () => {
    expect(parsePreview(good)).toEqual(gold);
  });

  it('accepts common field-name variants and numeric strings', () => {
    const p = parsePreview({ id: 'x9', action: 'buy', asset_name: 'Gold', amount: '1,000', fees: '15.00', total_amount: 1015, quote_currency: 'THB' });
    expect(p).toMatchObject({ preview_id: 'x9', amount: 1000, fee: 15, total: 1015, asset: 'Gold' });
  });

  it('fails closed when any field is missing', () => {
    for (const key of Object.keys(good)) {
      const copy: Record<string, unknown> = { ...good };
      delete copy[key];
      expect(parsePreview(copy), `missing ${key}`).toBeNull();
    }
  });

  it('rejects negative, NaN and junk numbers', () => {
    expect(parsePreview({ ...good, fee: -1 })).toBeNull();
    expect(parsePreview({ ...good, total: NaN })).toBeNull();
    expect(parsePreview({ ...good, amount: 'lots' })).toBeNull();
    expect(parsePreview({ ...good, side: 'hold' })).toBeNull();
  });
});

describe('findPreviewCard / extractPreview', () => {
  const good = { preview_id: 'p1', side: 'buy', asset: 'gold', amount: 1000, fee: 15, total: 1015, currency: 'THB' };

  it('finds a preview card among other actions', () => {
    const reply: AssistantReply = {
      text: 'x', speak: true, sources: [],
      ui_actions: [{ type: 'highlight', element_id: 'buy.fee_line' }, { type: 'show_card', card_type: 'Preview', data: good }],
    };
    expect(findPreviewCard(reply)).toEqual(good);
    expect(extractPreview(reply)).toEqual(gold);
  });

  it('ignores cards that are not previews', () => {
    expect(findPreviewCard(replyWith(good, 'comparison'))).toBeNull();
  });

  it('returns null for an incomplete card, so voice confirm is never offered', () => {
    const { fee: _fee, ...broken } = good;
    expect(findPreviewCard(replyWith(broken))).not.toBeNull();
    expect(extractPreview(replyWith(broken))).toBeNull();
  });
});
