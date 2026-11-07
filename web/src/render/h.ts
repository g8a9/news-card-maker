// A tiny DOM builder (PLAN.md §7.1, §12.4). Text only ever goes in through text nodes, URL attributes
// are checked, and event-handler or markup-injecting attributes are refused. No innerHTML anywhere.

export type Child = Node | string | number | null | undefined | false;

type StyleValue = string | number | null | undefined;
export interface Attrs {
  class?: string | false | null;
  style?: Record<string, StyleValue> | string;
  dataset?: Record<string, string | number | boolean | null | undefined>;
  on?: Record<string, (event: Event) => void>;
  [name: string]: unknown;
}

const FORBIDDEN_ATTRIBUTE = /^on|^srcdoc$|^innerhtml$|^outerhtml$|^textcontent$/i;
const URL_ATTRIBUTES = new Set(['src', 'href', 'poster']);

/** http(s), blob: and data:image/ URLs only. Anything else (javascript:, data:text/html) is dropped. */
export function isSafeUrl(value: string): boolean {
  const v = value.trim();
  return (
    /^(https?:\/\/|blob:)/i.test(v) ||
    /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(v)
  );
}

function applyAttrs(el: Element, attrs: Attrs): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'class') el.setAttribute('class', String(value));
    else if (name === 'style') {
      if (typeof value === 'string') el.setAttribute('style', value);
      else
        for (const [k, v] of Object.entries(value as Record<string, StyleValue>)) {
          if (v !== null && v !== undefined) (el as HTMLElement).style.setProperty(k, String(v));
        }
    } else if (name === 'dataset') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v !== null && v !== undefined && v !== false)
          (el as HTMLElement).dataset[k] = String(v);
      }
    } else if (name === 'on') {
      for (const [type, handler] of Object.entries(value as Record<string, EventListener>)) {
        el.addEventListener(type, handler);
      }
    } else if (FORBIDDEN_ATTRIBUTE.test(name)) {
      throw new Error(`h(): attribute "${name}" is not allowed`);
    } else if (URL_ATTRIBUTES.has(name)) {
      if (isSafeUrl(String(value))) el.setAttribute(name, String(value));
    } else if (value === true) el.setAttribute(name, '');
    else el.setAttribute(name, String(value));
  }
}

function append(el: Element, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(
      typeof child === 'string' || typeof child === 'number'
        ? document.createTextNode(String(child))
        : child,
    );
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) applyAttrs(el, attrs);
  append(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** SVG elements (icons). Attributes are plain; there is no way to inject markup. */
export function svg(
  tag: string,
  attrs: Record<string, string | number> | null = null,
  ...children: Child[]
): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (FORBIDDEN_ATTRIBUTE.test(k)) throw new Error(`svg(): attribute "${k}" is not allowed`);
    el.setAttribute(k, String(v));
  }
  append(el, children);
  return el as SVGElement;
}
