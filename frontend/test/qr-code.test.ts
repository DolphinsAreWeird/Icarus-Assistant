import { beforeEach, expect, it } from 'vitest';
import { installQrCode, QR_SIZE } from '../src/qr-code';

beforeEach(() => { document.body.innerHTML = ''; });

it('puts the QR code in the top right corner', () => {
  const box = installQrCode();
  expect(document.getElementById('icarus-qr')).toBe(box);
  expect(box.style.position).toBe('fixed');
  expect(box.style.top).toBe('14px');
  expect(box.style.right).toBe('14px');
  expect(box.style.width).toBe(`${QR_SIZE}px`);
  expect(box.querySelector('img')?.getAttribute('src')).toBe('qr.png');
});

it('removes itself if the image is missing', () => {
  const box = installQrCode();
  box.querySelector('img')!.dispatchEvent(new Event('error'));
  expect(document.getElementById('icarus-qr')).toBeNull();
});
