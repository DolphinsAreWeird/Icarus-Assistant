import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DASHBOARD_COPY, JUDGE_COPY, LIVE_DATA_COPY, PRODUCT_POLISH, withJudgeCopy } from '../src/judge-copy';

const PROTOTYPE = readFileSync(path.join(__dirname, '..', 'prototype', 'Icarus Prototype.dc.html'), 'utf8');
const DASHBOARD = readFileSync(path.join(__dirname, '..', 'prototype', 'Icarus Business Dashboard.dc.html'), 'utf8');

describe('judge copy', () => {
  it('finds every line it changes in the current design (a new export from Oasis would show up here)', () => {
    for (const [from] of [...JUDGE_COPY, ...PRODUCT_POLISH, ...LIVE_DATA_COPY]) expect(PROTOTYPE, from).toContain(from);
  });

  it('leaves no design placeholder, no John Doe and no dollar amounts on screen', () => {
    const out = withJudgeCopy(PROTOTYPE, { liveData: true });
    for (const gone of ['network logo', 'brand logo', '>photo<', 'John Doe', 'JOHN DOE', 'Hi John', '$8,448.60', 'Demo prices · not live', 'Balance 2,140.00'])
      expect(out, gone).not.toContain(gone);
    expect(out).toContain('VISA');
    expect(out).toContain('Mint Srisuk');
  });

  it('keeps the honest prototype labels when there is no backend', () => {
    expect(withJudgeCopy(PROTOTYPE)).toContain('Demo prices · not live');
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

it('every dashboard replacement still matches the dashboard design', () => {
  for (const [from] of DASHBOARD_COPY) expect(DASHBOARD, from).toContain(from);
  expect(withJudgeCopy(DASHBOARD)).not.toMatch(/Scenario [AB]|฿1,010/);
});
