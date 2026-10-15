import { describe, expect, it } from 'vitest';
import { GLOBAL_COMMANDS, matchCommand, normalizeUtterance } from '../src/shared/commands';

describe('global commands (English)', () => {
  it.each([
    ['stop', 'stop'],
    ['Stop.', 'stop'],
    ['wait', 'stop'],
    ['Wait!', 'stop'],
    ['hold on please', 'stop'],
    ['okay stop', 'stop'],
    ['repeat that', 'repeat'],
    ['Say that again', 'repeat'],
    ['go back', 'back'],
    ['louder', 'louder'],
    ['louder please', 'louder'],
    ['slow down', 'slower'],
  ])('%s -> %s', (text, expected) => {
    expect(matchCommand(text, GLOBAL_COMMANDS)).toBe(expected);
  });

  it('does not treat real questions as commands', () => {
    for (const text of ['what is the fee', 'take me to gold', 'what is a stop loss order', 'how do I go back to my portfolio', 'stopwatch']) {
      expect(matchCommand(text, GLOBAL_COMMANDS), text).toBeNull();
    }
  });
});

describe('global commands (Thai)', () => {
  it.each([
    ['หยุด', 'stop'],
    ['รอก่อนครับ', 'stop'],
    ['หยุดก่อน', 'stop'],
    ['พูดอีกครั้งค่ะ', 'repeat'],
    ['ย้อนกลับ', 'back'],
    ['ดังขึ้น', 'louder'],
    ['พูดช้าลงหน่อย', 'slower'],
  ])('%s -> %s', (text, expected) => {
    expect(matchCommand(text, GLOBAL_COMMANDS)).toBe(expected);
  });
});

describe('confirm and cancel', () => {
  const both = ['cancel', 'stop', 'confirm'] as const;

  it('accepts exact confirm phrases only', () => {
    for (const text of ['confirm', 'Confirm.', 'yes confirm', 'please confirm', 'I confirm', 'ยืนยัน', 'ยืนยันครับ']) {
      expect(matchCommand(text, ['confirm']), text).toBe('confirm');
    }
  });

  it('never confirms on loose speech', () => {
    for (const text of ['yes', 'ok', 'okay', 'sure', 'do it', "don't confirm", 'do not confirm', 'confirm the fee is wrong', 'I cannot confirm that', 'ใช่', 'โอเค', 'ตกลง']) {
      expect(matchCommand(text, ['confirm']), text).toBeNull();
    }
  });

  it('cancels on short sentences that contain cancel', () => {
    for (const text of ['cancel', 'no cancel that', 'cancel it please', 'ยกเลิก', 'ยกเลิกเลยครับ', 'ไม่เอา']) {
      expect(matchCommand(text, ['cancel']), text).toBe('cancel');
    }
  });

  it('puts the first allowed command first when two match', () => {
    expect(matchCommand('wait cancel', [...both])).toBe('cancel');
  });
});

describe('normalizeUtterance', () => {
  it('lowercases and removes punctuation', () => {
    expect(normalizeUtterance('  Hello,   World!! ')).toBe('hello world');
  });
});
