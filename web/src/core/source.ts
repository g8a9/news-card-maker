// Helpers for page source the user supplies: pasted text or a saved .html file (PLAN.md §9.2, §11).
import { resolveUrl } from './url.ts';

/** Page source longer than this is refused: a real article page is far below it. */
export const MAX_SOURCE_CHARS = 8_000_000;

/** True for text that plausibly is an HTML document rather than a sentence or a link. */
export function looksLikeHtml(text: string): boolean {
  return /<(?:!doctype\s+html|html|head|body|meta|title)\b/i.test(text.slice(0, 50_000));
}

const SAVED_FROM = /<!--\s*saved from url=\(\d+\)\s*(https?:\/\/[^\s>]+?)\s*-->/i;

/**
 * The address a saved or pasted page came from, when the page says so: the "saved from url" comment
 * that browsers add to saved pages, then the canonical link, `og:url` and `<base>`.
 */
export function guessPageUrl(doc: Document, html: string): string | null {
  const candidates = [
    SAVED_FROM.exec(html.slice(0, 5_000))?.[1],
    doc.querySelector('link[rel~="canonical" i]')?.getAttribute('href'),
    doc.querySelector('meta[property="og:url" i]')?.getAttribute('content'),
    doc.querySelector('base[href]')?.getAttribute('href'),
  ];
  for (const candidate of candidates) {
    // Relative values are no use here: there is nothing to resolve them against.
    if (!candidate || !/^https?:\/\//i.test(candidate.trim())) continue;
    const url = resolveUrl(candidate, 'https://invalid.example/');
    if (url) return url;
  }
  return null;
}
