// A QR code in the top right corner of the screen, so a visitor can scan it and open the demo on their phone.
// The image is public/qr.png (copied to qr.png by scripts/build.mjs). The Tour pill sits just to its left (tour.ts).
export const QR_SIZE = 100;

export function installQrCode(doc: Document = document): HTMLElement {
  const box = doc.createElement('div');
  box.id = 'icarus-qr';
  box.setAttribute('aria-label', 'QR code to open the demo on your phone');
  box.style.cssText = `position:fixed;top:14px;right:14px;z-index:9500;width:${QR_SIZE}px;height:${QR_SIZE}px;box-sizing:border-box;padding:6px;` +
    'background:#fff;border-radius:14px;box-shadow:0 4px 14px rgba(150,60,85,.18);display:flex;align-items:center;justify-content:center';
  const img = doc.createElement('img');
  img.src = 'qr.png';
  img.alt = 'QR code';
  img.style.cssText = 'width:100%;height:100%;object-fit:contain;image-rendering:pixelated';
  img.onerror = () => box.remove(); // no image, no box: never an empty white square
  box.append(img);
  doc.body.append(box);
  return box;
}
