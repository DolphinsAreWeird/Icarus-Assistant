// A small runtime for Oasis's ".dc.html" design files.
//
// A .dc.html file is a React component written as an HTML template plus a logic class:
//
//   <x-dc>
//     <helmet> ...fonts and global CSS... </helmet>
//     <div style="color:{{ textColor }}" onClick="{{ onTap }}">
//       <sc-if value="{{ showIt }}"> ... </sc-if>
//       <sc-for list="{{ items }}" as="item"> {{ item.label }} </sc-for>
//     </div>
//   </x-dc>
//   <script type="text/x-dc" data-dc-script data-props="{...}">
//     class Component extends DCLogic { ... renderVals() { return { textColor, onTap, showIt, items } } }
//   </script>
//
// The original runtime (support.js) is not available, so this file does its job:
//   1. parse the file,
//   2. compile the template ONCE into a function (scope) => React elements,
//   3. subclass the logic class so render() = template(renderVals()).
//
// What the template language needs (checked against the real file, nothing more is supported):
//   - {{ name }} and {{ a.b.c }}: plain names and dotted paths only, never expressions
//   - <sc-if value="{{ x }}"> and <sc-for list="{{ xs }}" as="x">
//   - event attributes, ref="{{ r }}", inline style strings with bindings inside

import React from 'react';
import { mapAssets } from './assets';

export type Scope = Record<string, unknown>;
type Render = (scope: Scope, key: string | number) => React.ReactNode;

// ---------------------------------------------------------------------------
// 1. Parse
// ---------------------------------------------------------------------------

export interface ParsedDc {
  /** Everything inside <x-dc> except <helmet>. */
  template: Node[];
  /** The <helmet> element: fonts, global CSS. */
  helmet: Element | null;
  /** Source of the logic class. */
  script: string;
  /** Default values from data-props. */
  propDefaults: Record<string, unknown>;
}

export function parseDc(html: string): ParsedDc {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.querySelector('x-dc');
  if (!root) throw new Error('No <x-dc> element found. Is this a .dc.html file?');
  const helmet = root.querySelector(':scope > helmet');
  const scriptEl = doc.querySelector('script[data-dc-script]');
  if (!scriptEl) throw new Error('No <script data-dc-script> found.');

  const propDefaults: Record<string, unknown> = {};
  try {
    const spec = JSON.parse(scriptEl.getAttribute('data-props') ?? '{}') as Record<string, { default?: unknown }>;
    for (const [name, def] of Object.entries(spec)) if ('default' in def) propDefaults[name] = def.default;
  } catch {
    // No usable props spec. The logic gets no defaults.
  }
  return {
    template: [...root.childNodes].filter((n) => n !== helmet),
    helmet,
    script: scriptEl.textContent ?? '',
    propDefaults,
  };
}

// ---------------------------------------------------------------------------
// 2. Bindings
// ---------------------------------------------------------------------------

const BINDING = /\{\{\s*([^}]+?)\s*\}\}/g;
const WHOLE_BINDING = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;

/** Look up "a.b.c" in the scope (which may inherit from outer scopes). */
export function lookup(scope: Scope, path: string): unknown {
  let value: unknown = scope;
  for (const part of path.split('.')) {
    if (value === null || value === undefined) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/** Replace every {{ path }} in a string. Missing values become empty text. */
function interpolate(text: string, scope: Scope): string {
  return text.replace(BINDING, (_m, path: string) => {
    const v = lookup(scope, path);
    return v === null || v === undefined || v === false ? '' : String(v);
  });
}

const hasBinding = (text: string) => text.includes('{{');

// ---------------------------------------------------------------------------
// 3. Attributes
// ---------------------------------------------------------------------------

const EVENTS: Record<string, string> = {
  onclick: 'onClick', ondblclick: 'onDoubleClick', onchange: 'onChange', oninput: 'onInput', onsubmit: 'onSubmit',
  onkeydown: 'onKeyDown', onkeyup: 'onKeyUp', onkeypress: 'onKeyPress', onfocus: 'onFocus', onblur: 'onBlur',
  onscroll: 'onScroll', onwheel: 'onWheel',
  onpointerdown: 'onPointerDown', onpointerup: 'onPointerUp', onpointermove: 'onPointerMove',
  onpointerleave: 'onPointerLeave', onpointerenter: 'onPointerEnter', onpointercancel: 'onPointerCancel',
  onmousedown: 'onMouseDown', onmouseup: 'onMouseUp', onmousemove: 'onMouseMove', onmouseleave: 'onMouseLeave', onmouseenter: 'onMouseEnter',
  ontouchstart: 'onTouchStart', ontouchend: 'onTouchEnd', ontouchmove: 'onTouchMove',
};

const RENAMED: Record<string, string> = {
  class: 'className', for: 'htmlFor', tabindex: 'tabIndex', readonly: 'readOnly', maxlength: 'maxLength',
  autocomplete: 'autoComplete', autofocus: 'autoFocus', contenteditable: 'contentEditable', spellcheck: 'spellCheck',
  colspan: 'colSpan', rowspan: 'rowSpan', crossorigin: 'crossOrigin', 'xlink:href': 'xlinkHref',
  srcset: 'srcSet', enterkeyhint: 'enterKeyHint', inputmode: 'inputMode',
};

const BOOLEAN_ATTRS = new Set(['disabled', 'checked', 'readonly', 'autofocus', 'multiple', 'selected', 'hidden', 'required', 'autoplay', 'controls', 'loop', 'muted']);

/** "stroke-width" to "strokeWidth". data- and aria- names stay as they are. */
function reactName(name: string): string {
  if (RENAMED[name]) return RENAMED[name];
  if (name.startsWith('data-') || name.startsWith('aria-')) return name;
  return name.includes('-') ? name.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase()) : name;
}

/** Split a CSS declaration list on ";" that are not inside () or quotes (data: URLs contain ";"). */
function splitDeclarations(css: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const ch of css) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current);
  return out;
}

export function parseStyle(css: string): React.CSSProperties {
  const style: Record<string, string> = {};
  for (const decl of splitDeclarations(css)) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (!prop || !value) continue;
    const key = prop.startsWith('--') ? prop : prop.replace(/^-ms-/, 'ms-').replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
    style[key] = value;
  }
  return style as React.CSSProperties;
}

type AttrCompiler = (scope: Scope) => [string, unknown] | null;

function compileAttribute(name: string, raw: string): AttrCompiler | null {
  const lower = name.toLowerCase();

  // Events
  if (lower.startsWith('on')) {
    const target = EVENTS[lower];
    if (!target) {
      console.warn(`[dc-runtime] event attribute "${name}" is not supported and was ignored`);
      return null;
    }
    const whole = WHOLE_BINDING.exec(raw);
    if (!whole) return null;
    const path = whole[1] as string;
    return (scope) => {
      const fn = lookup(scope, path);
      return typeof fn === 'function' ? [target, fn] : null;
    };
  }

  // ref
  if (lower === 'ref') {
    const whole = WHOLE_BINDING.exec(raw);
    if (!whole) return null;
    const path = whole[1] as string;
    return (scope) => [ 'ref', lookup(scope, path) ];
  }

  // style
  if (lower === 'style') {
    if (!hasBinding(raw)) {
      // Plain style. Parse once, unless it mentions a mascot image: then the answer depends on
      // whether the real images exist, which is only known at render time.
      if (!raw.includes('mascot/')) {
        const fixed = parseStyle(raw);
        return () => ['style', fixed];
      }
      return () => ['style', parseStyle(mapAssets(raw))];
    }
    return (scope) => ['style', parseStyle(mapAssets(interpolate(raw, scope)))];
  }

  const prop = reactName(RENAMED[lower] ? lower : name);

  // One whole binding: pass the real value (could be a boolean, number, function).
  const whole = WHOLE_BINDING.exec(raw);
  if (whole) {
    const path = whole[1] as string;
    return (scope) => {
      const v = lookup(scope, path);
      if (v === undefined || v === null || v === false) return BOOLEAN_ATTRS.has(lower) ? [prop, false] : null;
      return [prop, typeof v === 'string' ? mapAssets(v) : v];
    };
  }

  // Text with bindings inside
  if (hasBinding(raw)) return (scope) => [prop, mapAssets(interpolate(raw, scope))];

  // Plain attribute. mapAssets runs at render time (not here), see above.
  if (BOOLEAN_ATTRS.has(lower) && (raw === '' || raw === lower)) return () => [prop, true];
  return () => [prop, mapAssets(raw)];
}

// ---------------------------------------------------------------------------
// 4. Compile the template
// ---------------------------------------------------------------------------

function compileNode(node: Node): Render | null {
  if (node.nodeType === Node.COMMENT_NODE) return null;

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    // Indentation between tags is formatting. A lone space between inline items still counts.
    if (!text.trim() && text.includes('\n')) return null;
    if (!hasBinding(text)) return () => text;
    return (scope) => interpolate(text, scope);
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.localName;
  const children = compileChildren(el);

  // <sc-if value="{{ x }}">
  if (tag === 'sc-if') {
    const raw = el.getAttribute('value') ?? '';
    const whole = WHOLE_BINDING.exec(raw);
    const path = whole?.[1];
    return (scope, key) => {
      const on = path ? lookup(scope, path) : raw !== '' && raw !== 'false';
      return on ? React.createElement(React.Fragment, { key }, ...children(scope)) : null;
    };
  }

  // <sc-for list="{{ xs }}" as="x">
  if (tag === 'sc-for') {
    const path = WHOLE_BINDING.exec(el.getAttribute('list') ?? '')?.[1];
    const as = el.getAttribute('as') ?? 'item';
    return (scope, key) => {
      const list = path ? lookup(scope, path) : [];
      const items = Array.isArray(list) ? list : [];
      return React.createElement(
        React.Fragment,
        { key },
        items.map((item, index) => {
          // The loop variable is visible to the children, and the outer scope still is too.
          const inner: Scope = Object.create(scope);
          inner[as] = item;
          inner.index = index;
          return React.createElement(React.Fragment, { key: index }, ...children(inner));
        }),
      );
    };
  }

  // A normal element
  const attrs: AttrCompiler[] = [];
  for (const attr of [...el.attributes]) {
    if (attr.name === 'hint-placeholder-val' || attr.name === 'hint-placeholder-count') continue; // editor hints
    const compiled = compileAttribute(attr.name, attr.value);
    if (compiled) attrs.push(compiled);
  }

  return (scope, key) => {
    const props: Record<string, unknown> = { key };
    for (const run of attrs) {
      const pair = run(scope);
      if (pair) props[pair[0]] = pair[1];
    }
    const kids = children(scope);
    return React.createElement(tag, props, ...(kids.length ? kids : []));
  };
}

function compileChildren(el: Element): (scope: Scope) => React.ReactNode[] {
  const compiled = [...el.childNodes].map(compileNode).filter((r): r is Render => r !== null);
  return (scope) => compiled.map((render, i) => render(scope, i));
}

export function compileTemplate(nodes: Node[]): (scope: Scope) => React.ReactNode {
  const compiled = nodes.map(compileNode).filter((r): r is Render => r !== null);
  return (scope) => React.createElement(React.Fragment, null, ...compiled.map((render, i) => render(scope, i)));
}

// ---------------------------------------------------------------------------
// 5. The logic class
// ---------------------------------------------------------------------------

/** The base class the logic extends. In the original runtime it is React's component. */
export const DCLogic = React.Component;

/** Run the script and get the class it defines (the file calls it `Component`). */
export function loadLogic(script: string): new (props: Record<string, unknown>) => React.Component {
  const factory = new Function('React', 'DCLogic', `${script}\n;return Component;`) as (r: typeof React, base: typeof DCLogic) => new (props: Record<string, unknown>) => React.Component;
  return factory(React, DCLogic);
}

export interface DcApp {
  /** Mount this with React. Props are merged over the defaults from data-props. */
  Root: React.ComponentType<Record<string, unknown> & { instanceRef?: (c: unknown) => void }>;
  helmet: Element | null;
  propDefaults: Record<string, unknown>;
}

export function createDcApp(html: string): DcApp {
  const parsed = parseDc(html);
  const Logic = loadLogic(parsed.script) as unknown as new (props: Record<string, unknown>) => React.Component & { renderVals(): Scope };
  const template = compileTemplate(parsed.template);

  // Same class, plus render(): the template filled with whatever renderVals() returns.
  class Root extends (Logic as unknown as typeof React.Component) {
    render(): React.ReactNode {
      return template((this as unknown as { renderVals(): Scope }).renderVals());
    }
  }

  const defaults = parsed.propDefaults;
  const Wrapper: DcApp['Root'] = (props) => {
    const { instanceRef, ...rest } = props;
    return React.createElement(Root as unknown as React.ComponentType<Record<string, unknown>>, {
      ...defaults,
      ...rest,
      ref: instanceRef,
    });
  };
  return { Root: Wrapper, helmet: parsed.helmet, propDefaults: defaults };
}

/** Put the <helmet> contents (fonts, global CSS) into the page head once. */
export function installHelmet(helmet: Element | null): void {
  if (!helmet) return;
  for (const child of [...helmet.children]) {
    const clone = document.importNode(child, true);
    clone.setAttribute('data-dc-helmet', '');
    document.head.appendChild(clone);
  }
}
