// <link> tags and <base> (PLAN.md §5.3, "Links"). URLs are always resolved with `new URL(href, base)`,
// never against document.baseURI: a DOMParser document's base is the app's own URL.
import { resolveUrl } from '../url.ts';

export interface IconLink {
  url: string;
  rel: 'icon' | 'apple-touch-icon' | 'mask-icon';
  /** Largest declared size in px, or 0 when unknown / "any". */
  size: number;
  type?: string;
  color?: string;
}

export interface LinkInfo {
  base: string;
  canonical?: string;
  amp?: string;
  manifest?: string;
  imageSrc?: string;
  oembed?: string;
  feeds: string[];
  icons: IconLink[];
}

/** `<base href>` resolved against the page URL, else the page URL. */
export function baseUrl(doc: Document, pageUrl: string): string {
  const href = doc.querySelector('base[href]')?.getAttribute('href');
  return resolveUrl(href, pageUrl) ?? pageUrl;
}

function largestSize(sizes: string | null): number {
  if (!sizes) return 0;
  let best = 0;
  for (const part of sizes.toLowerCase().split(/\s+/)) {
    const m = /^(\d+)x(\d+)$/.exec(part);
    if (m) best = Math.max(best, Number(m[1]));
  }
  return best;
}

export function collectLinks(doc: Document, pageUrl: string): LinkInfo {
  const base = baseUrl(doc, pageUrl);
  const info: LinkInfo = { base, feeds: [], icons: [] };
  for (const el of doc.querySelectorAll('link[rel]')) {
    const rels = (el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const href = el.getAttribute('href');
    const url = resolveUrl(href, base, { allowDataImage: rels.some((r) => r.includes('icon')) });
    if (!url) continue;
    const type = (el.getAttribute('type') ?? '').toLowerCase();

    if (rels.includes('canonical')) info.canonical ??= url;
    else if (rels.includes('amphtml')) info.amp ??= url;
    else if (rels.includes('manifest')) info.manifest ??= url;
    else if (rels.includes('image_src')) info.imageSrc ??= url;
    else if (rels.includes('alternate')) {
      if (/rss|atom/.test(type)) info.feeds.push(url);
      else if (type.includes('json+oembed')) info.oembed ??= url;
    } else if (rels.includes('mask-icon')) {
      info.icons.push({
        url,
        rel: 'mask-icon',
        size: 0,
        type,
        color: el.getAttribute('color') ?? undefined,
      });
    } else if (rels.some((r) => r.startsWith('apple-touch-icon'))) {
      info.icons.push({
        url,
        rel: 'apple-touch-icon',
        size: largestSize(el.getAttribute('sizes')),
      });
    } else if (rels.includes('icon')) {
      const sizes = el.getAttribute('sizes') ?? '';
      info.icons.push({
        url,
        rel: 'icon',
        size: /\bany\b/i.test(sizes) ? 0 : largestSize(sizes),
        type,
      });
    }
  }
  info.feeds = [...new Set(info.feeds)];
  return info;
}
