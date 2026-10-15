// Asset handling for the prototype.
//
// The prototype points at mascot images (mascot/bow/curious.png, hero.png ...). Those PNGs are not in
// the .dc.html file, so if they are not served next to the app we draw a simple placeholder mascot.
// Drop the real PNGs into frontend/public/mascot/bow/ and they are used automatically.

let useFallback = false;

/** Call once at startup, after checking whether the real images are there. */
export function setMascotFallback(on: boolean): void {
  useFallback = on;
}

/** The names the prototype uses: hero, icon, star, curious, working, sleepy, happy, excited. */
export function mascotSvg(name: string): string {
  const face = '#F7B9C9';
  const ink = '#4A2E36';
  const eyes: Record<string, string> = {
    happy: `<path d="M34 46q5-8 10 0M56 46q5-8 10 0" stroke="${ink}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`,
    excited: `<circle cx="39" cy="45" r="6" fill="${ink}"/><circle cx="61" cy="45" r="6" fill="${ink}"/><circle cx="41" cy="43" r="2" fill="#fff"/><circle cx="63" cy="43" r="2" fill="#fff"/>`,
    curious: `<circle cx="39" cy="46" r="5" fill="${ink}"/><circle cx="61" cy="46" r="5" fill="${ink}"/><path d="M52 33q8-6 15-1" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    star: `<path d="M39 38l2.6 5.4 6 .8-4.4 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.4-4.2 6-.8zM61 38l2.6 5.4 6 .8-4.4 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.4-4.2 6-.8z" fill="#E8A317"/>`,
    working: `<circle cx="39" cy="48" r="4.5" fill="${ink}"/><circle cx="61" cy="48" r="4.5" fill="${ink}"/><path d="M30 38h18M52 38h18" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`,
    sleepy: `<path d="M33 47q6 5 12 0M55 47q6 5 12 0" stroke="${ink}" stroke-width="3.5" fill="none" stroke-linecap="round"/><text x="70" y="30" font-size="14" font-family="sans-serif" fill="${ink}" opacity=".6">z</text>`,
  };
  const mouths: Record<string, string> = {
    happy: `<path d="M40 62q10 10 20 0" stroke="${ink}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`,
    excited: `<path d="M38 60q12 18 24 0z" fill="${ink}"/>`,
    curious: `<circle cx="50" cy="66" r="4" fill="${ink}"/>`,
    star: `<path d="M38 60q12 16 24 0z" fill="${ink}"/>`,
    working: `<path d="M42 65h16" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>`,
    sleepy: `<path d="M44 65q6 4 12 0" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  };
  const key = ['happy', 'excited', 'curious', 'star', 'working', 'sleepy'].includes(name) ? name : 'happy';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<circle cx="50" cy="54" r="38" fill="${face}"/><circle cx="26" cy="62" r="6" fill="#F093AB" opacity=".55"/><circle cx="74" cy="62" r="6" fill="#F093AB" opacity=".55"/>` +
    `<path d="M50 17l-12-8v16zM50 17l12-8v16z" fill="#C94F72"/><circle cx="50" cy="17" r="4" fill="#A63C5C"/>` +
    `${eyes[key]}${mouths[key]}</svg>`
  );
}

/** An SVG as a data URL made only of safe characters, so it also works inside an unquoted url(...). */
function svgUrl(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

const MASCOT = /mascot\/bow\/([a-z0-9_-]+)\.png/gi;

/** Replace mascot image paths with the placeholder, when the real images are not available. */
export function mapAssets(text: string): string {
  if (!useFallback || !text.includes('mascot/')) return text;
  return text.replace(MASCOT, (_m, name: string) => svgUrl(mascotSvg(name.toLowerCase())));
}
