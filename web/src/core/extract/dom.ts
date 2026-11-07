// HTML-level sources (PLAN.md §5.3, "HTML"): <title>, h1, <time>, microdata, article images.
// Header-logo detection (§6.2) arrives with M8.
import { cleanText } from '../text.ts';
import { resolveUrl } from '../url.ts';

export interface TimeInfo {
  value: string;
  /** Inside the article header or main content rather than a sidebar or footer. */
  inArticle: boolean;
}

export interface ArticleImage {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
}

export interface HtmlInfo {
  lang?: string;
  dir?: string;
  title?: string;
  /** h1 texts, those inside article / main / [role=main] first. */
  h1: string[];
  times: TimeInfo[];
  microdata: { headline?: string; datePublished?: string; authors: string[] };
  articleImages: ArticleImage[];
}

const MAIN_SELECTOR = 'article, main, [role="main"]';

const textOf = (el: Element): string => cleanText(el.textContent ?? '');

/** Largest candidate of a srcset, as [url, width]. */
function bestFromSrcset(srcset: string | null): { url: string; width: number } | null {
  if (!srcset) return null;
  let best: { url: string; width: number } | null = null;
  for (const part of srcset.split(/,\s+(?=\S)/)) {
    const [url, descriptor] = part.trim().split(/\s+/);
    if (!url) continue;
    const width = descriptor?.endsWith('w')
      ? Number.parseInt(descriptor, 10)
      : descriptor?.endsWith('x')
        ? Number.parseFloat(descriptor) * 1000
        : 0;
    if (!best || width > best.width) best = { url, width };
  }
  return best;
}

const NOT_CONTENT =
  /avatar|logo|icon|sprite|author|profile|badge|banner-ad|\bad\b|promo|social|share/i;

function articleImages(doc: Document, base: string): ArticleImage[] {
  const scope =
    doc.querySelector('article') ?? doc.querySelector('main, [role="main"]') ?? doc.body;
  if (!scope) return [];
  const out: ArticleImage[] = [];
  for (const img of scope.querySelectorAll('img')) {
    const hint = `${img.getAttribute('class') ?? ''} ${img.getAttribute('alt') ?? ''} ${img.getAttribute('src') ?? ''}`;
    if (NOT_CONTENT.test(hint)) continue;
    const declaredWidth = Number.parseInt(img.getAttribute('width') ?? '', 10);
    const declaredHeight = Number.parseInt(img.getAttribute('height') ?? '', 10);
    if (declaredWidth > 0 && declaredWidth < 200) continue;
    const fromSet = bestFromSrcset(img.getAttribute('srcset') ?? img.getAttribute('data-srcset'));
    const raw = fromSet?.url ?? img.getAttribute('data-src') ?? img.getAttribute('src');
    const url = resolveUrl(raw, base);
    if (!url) continue;
    out.push({
      url,
      width: Number.isFinite(declaredWidth) && declaredWidth > 0 ? declaredWidth : undefined,
      height: Number.isFinite(declaredHeight) && declaredHeight > 0 ? declaredHeight : undefined,
      alt: cleanText(img.getAttribute('alt') ?? '') || undefined,
    });
    if (out.length >= 3) break;
  }
  return out;
}

export function collectHtml(doc: Document, base: string): HtmlInfo {
  const root = doc.documentElement;
  const h1s = [...doc.querySelectorAll('h1')]
    .map((el) => ({ text: textOf(el), main: !!el.closest(MAIN_SELECTOR) }))
    .filter((h) => h.text);
  h1s.sort((a, b) => Number(b.main) - Number(a.main));

  const times: TimeInfo[] = [];
  for (const el of doc.querySelectorAll('time[datetime]')) {
    const value = el.getAttribute('datetime')?.trim();
    if (value) times.push({ value, inArticle: !!el.closest(`${MAIN_SELECTOR}, header`) });
    if (times.length >= 5) break;
  }
  times.sort((a, b) => Number(b.inArticle) - Number(a.inArticle));

  const headlineEl = doc.querySelector('[itemprop="headline"]:not(meta)');
  const dateEl = doc.querySelector('[itemprop="datePublished"]:not(meta)');
  const authors = [...doc.querySelectorAll('[itemprop="author"] [itemprop="name"]')]
    .map(textOf)
    .filter(Boolean);

  return {
    lang: root?.getAttribute('lang')?.trim() || undefined,
    dir: root?.getAttribute('dir')?.trim().toLowerCase() || undefined,
    title: doc.querySelector('title') ? textOf(doc.querySelector('title') as Element) : undefined,
    h1: h1s.slice(0, 3).map((h) => h.text),
    times,
    microdata: {
      headline: headlineEl ? textOf(headlineEl) : undefined,
      datePublished: dateEl
        ? (dateEl.getAttribute('content') ?? dateEl.getAttribute('datetime') ?? textOf(dateEl))
        : undefined,
      authors,
    },
    articleImages: articleImages(doc, base),
  };
}
