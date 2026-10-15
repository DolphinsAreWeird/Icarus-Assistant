import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { mapAssets, mascotSvg, setMascotFallback } from '../src/assets';
import { compileTemplate, lookup, parseDc, parseStyle } from '../src/dc-runtime';

/** Compile a template fragment and render it with a scope. */
function render(template: string, scope: Record<string, unknown> = {}): string {
  const doc = `<x-dc>${template}</x-dc><script type="text/x-dc" data-dc-script>class Component{}</script>`;
  const fn = compileTemplate(parseDc(doc).template);
  return renderToStaticMarkup(React.createElement(React.Fragment, null, fn(scope)));
}

describe('parseDc', () => {
  it('splits the template, helmet, script and prop defaults', () => {
    const html = `<x-dc><helmet><style>a{}</style></helmet><div>hi</div></x-dc>
      <script type="text/x-dc" data-dc-script data-props='{"mode":{"editor":"enum","default":"voice"},"flag":{"default":true},"noDefault":{"editor":"text"}}'>class Component{}</script>`;
    const p = parseDc(html);
    expect(p.helmet?.querySelector('style')).toBeTruthy();
    expect(p.template.filter((n) => n.nodeType === 1)).toHaveLength(1);
    expect(p.propDefaults).toEqual({ mode: 'voice', flag: true });
    expect(p.script).toContain('class Component');
  });
  it('says what is wrong when the file is not a .dc.html', () => {
    expect(() => parseDc('<html><body>nope</body></html>')).toThrow(/x-dc/);
  });
});

describe('bindings', () => {
  it('fills text and attributes', () => {
    expect(render('<a href="{{ url }}">Hello {{ user.name }}!</a>', { url: '/x', user: { name: 'John' } })).toBe('<a href="/x">Hello John!</a>');
  });
  it('looks up dotted paths and tolerates missing values', () => {
    expect(lookup({ a: { b: { c: 7 } } }, 'a.b.c')).toBe(7);
    expect(lookup({ a: null }, 'a.b')).toBeUndefined();
    expect(render('<p>[{{ nope.deeper }}]</p>')).toBe('<p>[]</p>');
  });
  it('keeps the real value for a whole binding (booleans, numbers)', () => {
    expect(render('<input disabled="{{ off }}" value="{{ n }}" readonly>', { off: true, n: 5 })).toContain('disabled=""');
    expect(render('<input disabled="{{ off }}">', { off: false })).not.toContain('disabled');
  });
  it('turns class and for into the React names and kebab SVG attributes into camel case', () => {
    expect(render('<label class="a" for="x">t</label>')).toBe('<label class="a" for="x">t</label>');
    expect(render('<svg viewBox="0 0 10 10"><path stroke-width="2" stroke-linecap="round" d="M0 0"></path></svg>')).toContain('stroke-width="2"');
  });
  it('leaves data- and aria- attributes alone', () => {
    expect(render('<div data-screen-label="Home" aria-label="x"></div>')).toBe('<div data-screen-label="Home" aria-label="x"></div>');
  });
});

describe('sc-if and sc-for', () => {
  it('shows or hides', () => {
    expect(render('<sc-if value="{{ on }}"><b>yes</b></sc-if>', { on: true })).toBe('<b>yes</b>');
    expect(render('<sc-if value="{{ on }}"><b>yes</b></sc-if>', { on: 0 })).toBe('');
    expect(render('<sc-if value="{{ missing }}"><b>yes</b></sc-if>')).toBe('');
  });
  it('loops with the loop variable, the index, and the outer scope', () => {
    const out = render('<ul><sc-for list="{{ items }}" as="it"><li>{{ index }}:{{ it.label }}/{{ owner }}</li></sc-for></ul>', {
      items: [{ label: 'a' }, { label: 'b' }],
      owner: 'me',
    });
    expect(out).toBe('<ul><li>0:a/me</li><li>1:b/me</li></ul>');
  });
  it('nests loops and ifs', () => {
    const out = render(
      '<sc-for list="{{ rows }}" as="r"><div><sc-for list="{{ r.cells }}" as="c"><sc-if value="{{ c.show }}"><i>{{ c.v }}</i></sc-if></sc-for></div></sc-for>',
      { rows: [{ cells: [{ show: true, v: 1 }, { show: false, v: 2 }] }, { cells: [{ show: true, v: 3 }] }] },
    );
    expect(out).toBe('<div><i>1</i></div><div><i>3</i></div>');
  });
  it('treats a missing list as empty', () => {
    expect(render('<sc-for list="{{ nope }}" as="x"><p>{{ x }}</p></sc-for>')).toBe('');
  });
});

describe('inline styles', () => {
  it('parses a style string into React style', () => {
    expect(parseStyle('background:#fff; border-radius:12px;-webkit-backdrop-filter:blur(4px);--tone:red')).toEqual({
      background: '#fff',
      borderRadius: '12px',
      WebkitBackdropFilter: 'blur(4px)',
      '--tone': 'red',
    });
  });
  it('does not split on ; inside url(data:...)', () => {
    const s = parseStyle('background:url(data:image/svg+xml;base64,AAA=) no-repeat;color:red') as Record<string, string>;
    expect(s.background).toBe('url(data:image/svg+xml;base64,AAA=) no-repeat');
    expect(s.color).toBe('red');
  });
  it('fills bindings inside style first', () => {
    expect(render('<div style="color:{{ c }};width:{{ w }}px"></div>', { c: 'red', w: 12 })).toBe('<div style="color:red;width:12px"></div>');
  });
});

describe('events and refs', () => {
  it('passes handlers and refs through', () => {
    const onTap = vi.fn();
    const ref = React.createRef<HTMLDivElement>();
    const fn = compileTemplate(parseDc('<x-dc><div onClick="{{ onTap }}" ref="{{ box }}">x</div></x-dc><script type="text/x-dc" data-dc-script>class Component{}</script>').template);
    const el = fn({ onTap, box: ref }) as React.ReactElement;
    const kids = el.props.children as React.ReactElement | React.ReactElement[];
    const div = Array.isArray(kids) ? (kids[0] as React.ReactElement) : kids;
    expect(div.props.onClick).toBe(onTap);
    expect((div as unknown as { ref: unknown }).ref).toBe(ref);
  });
  it('ignores an event name it does not know instead of crashing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(render('<div onweirdthing="{{ f }}">x</div>', { f: () => undefined })).toBe('<div>x</div>');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('static mascot images (regression: the fallback is decided at render time)', () => {
  it('swaps a plain src and a plain style url, even if the fallback is switched on after compiling', () => {
    const doc = '<x-dc><div><img src="mascot/bow/icon.png"><i style="background:url(mascot/bow/star.png);color:red"></i><b style="color:blue"></b></div></x-dc><script type="text/x-dc" data-dc-script>class Component{}</script>';
    const fn = compileTemplate(parseDc(doc).template); // compiled FIRST, like the app did
    const out = () => renderToStaticMarkup(React.createElement(React.Fragment, null, fn({})));
    setMascotFallback(false);
    expect(out()).toContain('src="mascot/bow/icon.png"');
    setMascotFallback(true);
    expect(out()).toMatch(/src="data:image\/svg\+xml;base64,/);
    expect(out()).toMatch(/background:url\(data:image\/svg\+xml;base64,/);
    expect(out()).toContain('color:blue'); // other styles are untouched
    setMascotFallback(false);
  });
});

describe('whitespace', () => {
  it('drops indentation between tags but keeps a single space between inline items', () => {
    expect(render('<p>\n  <span>a</span> <span>b</span>\n</p>')).toBe('<p><span>a</span> <span>b</span></p>');
  });
});

describe('mascot placeholder', () => {
  it('only rewrites mascot paths, and only when asked', () => {
    setMascotFallback(false);
    expect(mapAssets('mascot/bow/happy.png')).toBe('mascot/bow/happy.png');
    setMascotFallback(true);
    expect(mapAssets('mascot/bow/happy.png')).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(mapAssets('background:url(mascot/bow/hero.png)')).toMatch(/^background:url\(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+\)$/);
    expect(mapAssets('https://example.com/a.png')).toBe('https://example.com/a.png');
    setMascotFallback(false);
  });
  it('draws every mood the prototype asks for', () => {
    for (const name of ['happy', 'excited', 'curious', 'star', 'working', 'sleepy', 'hero', 'icon']) {
      expect(mascotSvg(name)).toMatch(/^<svg[\s\S]*<\/svg>$/);
    }
  });
});
