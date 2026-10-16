import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JUDGE_COPY, withJudgeCopy } from '../src/judge-copy';

const PROTOTYPE = readFileSync(path.join(__dirname, '..', 'prototype', 'Icarus Prototype.dc.html'), 'utf8');

describe('judge copy', () => {
  it('finds every presenter line in the current design (a new export from Oasis would show up here)', () => {
    for (const [from] of JUDGE_COPY) expect(PROTOTYPE, from).toContain(from);
  });

  it('replaces the presenter words and keeps the buttons and their actions', () => {
    const out = withJudgeCopy(PROTOTYPE);
    expect(out).toContain('Try Icarus yourself');
    expect(out).not.toContain('starts timer');
    expect(out).not.toContain('Scenario B request');
    for (const call of ["this.scenario('A')", "this.scenario('B')", "this.scenario('B2')", "this.scenario('G')"]) expect(out).toContain(call);
  });

  it('leaves text it does not know alone', () => {
    expect(withJudgeCopy('<div>Hello</div>')).toBe('<div>Hello</div>');
  });
});
