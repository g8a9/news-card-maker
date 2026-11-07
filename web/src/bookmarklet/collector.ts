// Runs on the news page itself (PLAN.md §11), in the user's own browser: it copies the page's preview
// metadata (the same thing a link preview shows) into a small HTML document and hands it to the app.
// It reads outerHTML of a few elements; nothing is ever written back to the page.
import type { Payload } from './payload.ts';

const grab = (doc: Document, selector: string, max = 50, cap = 200_000): string =>
  [...doc.querySelectorAll(selector)]
    .slice(0, max)
    .map((el) => el.outerHTML)
    .filter((html) => html.length <= cap)
    .join('');

/** An inline SVG with the <symbol> or <g> it pulls in through <use>, so it still draws on its own. */
function svgWithDefinitions(doc: Document, svg: Element, cap = 60_000): string {
  const defs: string[] = [];
  for (const use of svg.querySelectorAll('use')) {
    const ref = use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? '';
    const target = ref.startsWith('#') ? doc.getElementById(ref.slice(1)) : null;
    if (target) defs.push(target.outerHTML);
  }
  const markup =
    (defs.length ? `<svg style="display:none">${defs.join('')}</svg>` : '') + svg.outerHTML;
  return markup.length <= cap ? markup : '';
}

const HEADER_IMAGES = 'header img,[role=banner] img,a[href="/"] img';
const HEADER_SVGS = 'header svg,[role=banner] svg,a[href="/"] svg';

export function collectPage(doc: Document, url: string): Payload {
  const head =
    grab(doc, 'title', 1) +
    grab(doc, 'meta', 400, 5_000) +
    grab(
      doc,
      'link[rel~="icon"],link[rel^="apple-touch-icon"],link[rel="mask-icon"],link[rel="manifest"],link[rel="canonical"],link[rel="alternate"],link[rel="image_src"],link[rel="amphtml"]',
      60,
    ) +
    grab(doc, 'script[type="application/ld+json"]', 20);
  const logos = [...doc.querySelectorAll(HEADER_SVGS)]
    .slice(0, 4)
    .map((svg) => svgWithDefinitions(doc, svg))
    .join('');
  const body =
    grab(doc, 'h1', 3, 5_000) +
    grab(doc, 'time[datetime]', 5, 2_000) +
    grab(doc, HEADER_IMAGES, 6, 20_000) +
    logos;
  const lang = (doc.documentElement.lang || '').replace(/"/g, '');
  const base = url.replace(/"/g, '%22');
  return {
    v: 1,
    url,
    html: `<!doctype html><html lang="${lang}"><head><base href="${base}">${head}</head><body>${body}</body></html>`,
  };
}
