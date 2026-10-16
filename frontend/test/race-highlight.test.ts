// The two races are highlighted in the side console, so a visitor sees and taps them first.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createDcApp } from '../src/dc-runtime';
import { setMascotFallback } from '../src/assets';
import { withJudgeCopy } from '../src/judge-copy';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const HTML = readFileSync(path.join(__dirname, '../prototype/Icarus Prototype.dc.html'), 'utf8');
let root: Root;

beforeEach(async () => {
  document.head.innerHTML = '';
  document.body.innerHTML = '<div id="root"></div>';
  setMascotFallback(true);
  const app = createDcApp(withJudgeCopy(HTML));
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => root.render(React.createElement(app.Root, {})));
});
afterEach(async () => { await act(async () => root.unmount()); delete (window as { Icarus?: unknown }).Icarus; setMascotFallback(false); });

it('tints, rings and pulses the two race rows and rings the stopwatch; the other rows stay quiet', () => {
  const out = withJudgeCopy(HTML);
  expect(out.match(/pulse:'icPulse 1\.8s ease-in-out infinite'/g)).toHaveLength(2);
  expect(out.match(/pulse:'none'/g)).toHaveLength(4);
  expect(out).toContain('@keyframes icPulse');
  expect(out).toContain('The race: try both');
});

it('renders the race rows in the console with the highlight and no template leftovers', () => {
  const text = document.body.textContent ?? '';
  expect(text).toContain('The race: try both');
  expect(text).toContain('Race 1: without Icarus');
  expect(text).toContain('Race 2: with Icarus');
  expect(document.body.innerHTML).not.toMatch(/\{\{|undefined/);
  const starts = [...document.querySelectorAll<HTMLElement>('div')].filter((d) => d.textContent === 'Start' && d.style.animation.includes('icPulse'));
  expect(starts).toHaveLength(2);
  const racing = starts[0].parentElement as HTMLElement;
  expect(racing.style.background).toBeTruthy();
});
