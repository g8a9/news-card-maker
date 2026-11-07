// The pure extractor (PLAN.md §5): `extract(doc, ctx)` reads one parsed document and returns every
// candidate for every field, each with a source and a score. No network, no window, no
// document.baseURI. The parsed document is inert and is never attached to the live DOM.
import { isChallengeTitle } from '../blocked.ts';
import { normalizeColor } from '../color.ts';
import { dateFromUrl, parseDate } from '../dates.ts';
import type { Outlet } from '../registry.ts';
import {
  cleanText,
  fold,
  isInstitutionalAuthor,
  isJunkSection,
  isLegalEntityName,
  mostlyRtl,
  splitAuthors,
  stripTags,
  stripTitleSuffix,
  tokenOverlap,
  truncate,
} from '../text.ts';
import type { Candidate, Extraction, ImageRef, LogoRef, PartialDate, SourceId } from '../types.ts';
import { hostLabels, hostOf, resolveUrl } from '../url.ts';
import { collectHtml } from './dom.ts';
import {
  collectJsonLd,
  type LdNode,
  ldAuthors,
  ldImages,
  ldOrganizationLogos,
  ldPublisher,
  ldString,
  pickMainEntity,
  resolveRef,
} from './jsonld.ts';
import { collectLinks } from './links.ts';
import { collectMeta, collectOgImages } from './meta.ts';
import { pickBestCapitalised, rank } from './rank.ts';

export interface ExtractContext {
  /** Where the document came from (the final URL after redirects). Base for relative URLs. */
  pageUrl: string;
  /** What the user pasted. */
  inputUrl: string;
  outlet?: Outlet | null;
  /** For tests: the clock used by the date sanity window. */
  now?: number;
}

const RTL_LANGUAGES = new Set([
  'ar',
  'arc',
  'ckb',
  'dv',
  'fa',
  'he',
  'iw',
  'ps',
  'sd',
  'ug',
  'ur',
  'yi',
]);

const primarySubtag = (lang: string): string => lang.toLowerCase().split(/[-_]/)[0] ?? '';

/** Published-date meta keys (Appendix B.2). */
const PUBLISHED_META_KEYS = [
  'article:published_time',
  'datepublished',
  'publisheddate',
  'publishdate',
  'publish-date',
  'publish_date',
  'pubdate',
  'date',
  'dc.date',
  'dc.date.issued',
  'dc.date.created',
  'dcterms.created',
  'dcterms.issued',
  'citation_publication_date',
  'citation_date',
  'citation_online_date',
  'parsely-pub-date',
  'sailthru.date',
  'article.published',
  'original-publish-date',
];

const OVERLAY_MARKERS = /overlay-|\/branded|watermark/i;
const NON_PHOTO_WORDS =
  /(^|[^a-z0-9])(logo|placeholder|default|fallback|blank|sprite|avatar|icon)([^a-z0-9]|$)/i;

/** Quality multiplier for an image URL and its declared size (§5.5, "Image"). */
function imageQuality(url: string, width?: number, height?: number): number {
  let m = 1;
  if (OVERLAY_MARKERS.test(url)) m *= 0.6;
  let pathAndQuery = url;
  try {
    const u = new URL(url);
    // Drupal's /sites/default/files/ is a directory name, not a placeholder marker.
    pathAndQuery = `${u.pathname}${u.search}`.replace(/sites\/default\//gi, 'sites/_/');
  } catch {
    // keep the raw string
  }
  if (NON_PHOTO_WORDS.test(pathAndQuery)) m *= 0.3;
  if (width !== undefined && width < 400) m *= 0.3;
  if (width && height) {
    const aspect = width / height;
    if (aspect < 0.5 || aspect > 2.5) m *= 0.6;
  }
  return m;
}

/** "Okafor, Ngozi" (the citation_author convention) → "Ngozi Okafor". */
function flipLastFirst(name: string): string {
  const m = /^([^,]+),\s*([^,]+)$/.exec(name);
  return m ? `${m[2]} ${m[1]}` : name;
}

/** Which SourceId a meta key belongs to, so corroboration between families (dc + citation) counts. */
function metaSource(key: string): SourceId {
  if (key.startsWith('citation_')) return 'citation';
  if (key.startsWith('dc.') || key.startsWith('dcterms.')) return 'dc';
  if (key.startsWith('parsely')) return 'parsely';
  if (key.startsWith('sailthru')) return 'sailthru';
  return 'meta';
}

function tooShortForTitle(t: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(t)
    ? t.length < 5
    : t.length < 10;
}

const truthyFlag = (v: unknown): boolean | undefined => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (/^true$/i.test(v)) return true;
    if (/^false$/i.test(v)) return false;
  }
  return undefined;
};

export function extract(doc: Document, ctx: ExtractContext): Extraction {
  const now = ctx.now ?? Date.now();
  const meta = collectMeta(doc);
  const links = collectLinks(doc, ctx.pageUrl);
  const ld = collectJsonLd(doc);
  const base = links.base;
  const html = collectHtml(doc, base);
  const warnings = [...ld.warnings];
  const host = hostOf(ctx.pageUrl);

  // ---- URLs ----------------------------------------------------------------------------------
  const ogUrl = resolveUrl(meta.get('og:url'), base);
  const lookupUrls = [links.canonical, ogUrl, ctx.pageUrl, ctx.inputUrl].filter(
    (u): u is string => !!u,
  );
  const main: LdNode | null = pickMainEntity(ld, lookupUrls);

  const canonicalCandidates: Candidate<string>[] = [];
  const addCanonical = (url: string | null | undefined, source: SourceId, score: number) => {
    const resolved = resolveUrl(url, base);
    // A canonical never carries a fragment (a feed-style og:url may end in #ref=rss).
    if (resolved) canonicalCandidates.push({ value: resolved.replace(/#.*$/, ''), source, score });
  };
  addCanonical(links.canonical, 'link', 0.9);
  addCanonical(meta.get('og:url'), 'og', 0.8);
  addCanonical(main ? ldString(main.url) : undefined, 'jsonld', 0.7);
  addCanonical(ctx.pageUrl, 'url', 0.5);

  // ---- Site name -----------------------------------------------------------------------------
  const siteRaw: Candidate<string>[] = [];
  const addSite = (value: string | undefined, source: SourceId, score: number, note?: string) => {
    const v = value ? cleanText(value) : '';
    if (v && v.length <= 80) siteRaw.push({ value: v, source, score, note });
  };
  if (ctx.outlet) addSite(ctx.outlet.name, 'registry', 1.0);
  addSite(meta.get('og:site_name'), 'og', 0.85);
  const publisher = main ? ldPublisher(ld, main) : {};
  if (publisher.name) {
    // Legal-entity names ("Ediciones EL PAÍS S.L.") are poor brand names.
    addSite(
      publisher.name,
      'jsonld',
      isLegalEntityName(publisher.name) ? 0.8 * 0.6 : 0.8,
      'publisher',
    );
  }
  addSite(meta.get('application-name'), 'meta', 0.6);
  addSite(meta.get('apple-mobile-web-app-title'), 'meta', 0.55);
  if (html.title) {
    const parts = html.title.split(/\s[|\-–—·•»]\s/);
    const tail = parts.length > 1 ? parts[parts.length - 1] : undefined;
    if (tail && tail.length <= 40) addSite(tail, 'html', 0.45, 'title-tail');
  }
  addSite(host.replace(/^(www|m|amp)\./, ''), 'url', 0.2);

  // "Bloomberg.com" folds into "Bloomberg" when another candidate spells it that way.
  const siteMerged = siteRaw.map((c) => {
    const stripped = c.value.replace(/\.[a-z]{2,}(?:\.[a-z]{2})?$/i, '');
    if (stripped === c.value || c.source === 'url') return c;
    const twin = siteRaw.find((o) => o !== c && fold(o.value) === fold(stripped));
    return twin ? { ...c, value: twin.value } : c;
  });
  const siteName = rank(siteMerged, { key: fold, pick: pickBestCapitalised });
  const siteNames = siteRaw.map((c) => c.value);
  const siteFolds = new Set(siteNames.map(fold));

  // ---- Title ---------------------------------------------------------------------------------
  const ldHeadline = main ? (ldString(main.headline) ?? ldString(main.name)) : undefined;
  const ogTitle = meta.get('og:title');
  const references = [ldHeadline, ogTitle].filter((x): x is string => !!x).map(cleanText);
  const looksCjk = (s: string) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s);
  const validH1 = html.h1.map(cleanText).find((h) => {
    if (h.length > 300 || h.length < (looksCjk(h) ? 6 : 15)) return false;
    if (siteFolds.has(fold(h))) return false;
    if (references.length === 0) return true;
    return references.some((r) => tokenOverlap(h, r) >= 0.4 || tokenOverlap(r, h) >= 0.4);
  });

  const anchors = [validH1, ldHeadline ? cleanText(ldHeadline) : undefined].filter(
    (x): x is string => !!x,
  );
  const suffixContext = {
    anchors,
    siteNames,
    hostLabels: hostLabels(host),
    sections: [
      main ? ldString(main.articleSection) : undefined,
      meta.get('article:section'),
      meta.get('parsely-section'),
    ].filter((x): x is string => !!x),
    registrySuffixes: ctx.outlet?.titleSuffixes ?? [],
  };

  const titleRaw: Candidate<string>[] = [];
  const addTitle = (value: string | undefined, source: SourceId, base_: number, note?: string) => {
    if (!value) return;
    const cleaned = stripTitleSuffix(cleanText(value), suffixContext);
    if (!cleaned) return;
    let quality = 1;
    if (tooShortForTitle(cleaned) || cleaned.length > 300) quality *= 0.5;
    if (siteFolds.has(fold(cleaned))) quality *= 0.1;
    if (isChallengeTitle(cleaned)) quality = 0;
    titleRaw.push({ value: cleaned, source, score: base_ * quality, note });
  };
  addTitle(ldHeadline, 'jsonld', 0.9);
  addTitle(ogTitle, 'og', 0.88);
  addTitle(validH1, 'html', 0.86, 'h1');
  addTitle(meta.get('twitter:title'), 'twitter', 0.82);
  addTitle(html.microdata.headline, 'microdata', 0.78);
  addTitle(meta.get('parsely-title'), 'parsely', 0.75);
  addTitle(meta.get('sailthru.title'), 'sailthru', 0.75);
  addTitle(meta.get('citation_title'), 'citation', 0.75);
  addTitle(meta.get('dc.title'), 'dc', 0.75);
  addTitle(html.title, 'html', 0.5, 'title');
  const title = rank(titleRaw, { key: fold });

  // ---- Description (subtitle / deck) ---------------------------------------------------------
  const titleFolds = new Set(titleRaw.map((c) => fold(c.value)));
  const descRaw: Candidate<string>[] = [];
  const addDesc = (value: string | undefined, source: SourceId, base_: number) => {
    if (!value) return;
    let text = value.includes('<') ? stripTags(value) : cleanText(value);
    if (!text) return;
    let quality = 1;
    if (titleFolds.has(fold(text))) quality *= 0.2;
    if (/^(read more|click here|continue reading|leggi)/i.test(text)) quality *= 0.2;
    if (text.length < 20) quality *= 0.5;
    text = truncate(text, 400);
    descRaw.push({ value: text, source, score: base_ * quality });
  };
  addDesc(meta.get('og:description'), 'og', 0.85);
  addDesc(main ? ldString(main.description) : undefined, 'jsonld', 0.85);
  addDesc(main ? ldString(main.alternativeHeadline) : undefined, 'jsonld', 0.8);
  addDesc(meta.get('twitter:description'), 'twitter', 0.8);
  addDesc(meta.get('description'), 'meta', 0.75);
  const description = rank(descRaw, { key: fold });

  // ---- Kicker (section) ----------------------------------------------------------------------
  const kickerRaw: Candidate<string>[] = [];
  const addKicker = (value: unknown, source: SourceId, score: number) => {
    const text = ldString(value);
    const v = text ? cleanText(text) : '';
    if (v && !isJunkSection(v) && v.length <= 60) kickerRaw.push({ value: v, source, score });
  };
  addKicker(main?.articleSection, 'jsonld', 0.8);
  addKicker(meta.get('article:section'), 'article', 0.75);
  addKicker(meta.get('parsely-section'), 'parsely', 0.7);
  const kicker = rank(kickerRaw, { key: fold });

  // ---- Authors -------------------------------------------------------------------------------
  const authorRaw: Candidate<string[]>[] = [];
  const addAuthors = (
    names: string[],
    source: SourceId,
    score: number,
    options: { split?: boolean } = {},
  ) => {
    const people = names
      .flatMap((n) => (options.split === false ? [flipLastFirst(cleanText(n))] : splitAuthors(n)))
      .filter((n) => n && !isInstitutionalAuthor(n, siteNames));
    const unique = [...new Set(people)];
    if (unique.length > 0) authorRaw.push({ value: unique, source, score });
  };
  if (main) addAuthors(ldAuthors(ld, main.author), 'jsonld', 0.9);
  addAuthors(meta.all('citation_author'), 'citation', 0.85, { split: false });
  addAuthors(meta.all('author'), 'meta', 0.75);
  addAuthors(meta.all('parsely-author'), 'parsely', 0.75);
  addAuthors(meta.all('sailthru.author'), 'sailthru', 0.75);
  addAuthors(html.microdata.authors, 'microdata', 0.7);
  addAuthors(
    meta.all('article:author').filter((v) => !/^https?:/i.test(v)),
    'article',
    0.6,
  );
  const authors = rank(authorRaw, { key: (v) => v.map(fold).join('|') });

  // ---- Dates ---------------------------------------------------------------------------------
  const publishedRaw: Candidate<PartialDate>[] = [];
  const addDate = (
    list: Candidate<PartialDate>[],
    raw: unknown,
    source: SourceId,
    score: number,
    note?: string,
  ) => {
    const d = parseDate(raw, now);
    if (d) list.push({ value: d, source, score, note });
  };
  addDate(publishedRaw, main?.datePublished ?? main?.dateCreated, 'jsonld', 0.9);
  addDate(publishedRaw, meta.get('article:published_time'), 'article', 0.88);
  for (const key of PUBLISHED_META_KEYS.slice(1)) {
    addDate(publishedRaw, meta.get(key), metaSource(key), 0.75, key);
  }
  addDate(publishedRaw, html.microdata.datePublished, 'microdata', 0.7);
  for (const t of html.times)
    addDate(publishedRaw, t.value, 'html', t.inArticle ? 0.65 : 0.45, 'time');
  const urlDate = dateFromUrl(canonicalCandidates[0]?.value ?? ctx.pageUrl, now);
  if (urlDate) publishedRaw.push({ value: urlDate, source: 'url', score: 0.5 });
  const dayKey = (d: PartialDate) => `${d.y}-${d.m}-${d.d}`; // same day in different offsets agree
  const published = rank(publishedRaw, { key: dayKey });

  const modifiedRaw: Candidate<PartialDate>[] = [];
  addDate(modifiedRaw, main?.dateModified, 'jsonld', 0.9);
  addDate(modifiedRaw, meta.get('article:modified_time'), 'article', 0.88);
  addDate(modifiedRaw, meta.get('og:updated_time'), 'og', 0.8);
  addDate(modifiedRaw, meta.get('datemodified'), 'meta', 0.75);
  addDate(modifiedRaw, meta.get('dcterms.modified'), 'dc', 0.7);
  const modified = rank(modifiedRaw, { key: dayKey });

  // ---- Images --------------------------------------------------------------------------------
  const imageRaw: Candidate<ImageRef>[] = [];
  const addImage = (
    url: string | null | undefined,
    source: SourceId,
    score: number,
    size: { width?: number; height?: number; alt?: string } = {},
    note?: string,
  ) => {
    const resolved = resolveUrl(url, base);
    if (!resolved) return;
    const ref: ImageRef = { url: resolved, ...size };
    imageRaw.push({
      value: ref,
      source,
      score: score * imageQuality(resolved, size.width, size.height),
      note,
    });
    for (const rule of ctx.outlet?.imageRewrites ?? []) {
      try {
        const re = new RegExp(rule.pattern);
        if (re.test(resolved)) {
          // A known fix for a known problem (for example a branded variant): offer the repaired URL.
          imageRaw.push({
            value: {
              ...ref,
              url: resolved.replace(re, rule.replace),
              width: undefined,
              height: undefined,
            },
            source: 'registry',
            score,
            note: 'rewritten',
          });
        }
      } catch {
        warnings.push('bad-image-rewrite');
      }
    }
  };
  for (const og of collectOgImages(meta)) {
    addImage(og.secureUrl ?? og.url, 'og', 0.9, {
      width: og.width,
      height: og.height,
      alt: og.alt,
    });
  }
  const twitterAlt = meta.get('twitter:image:alt');
  addImage(meta.get('twitter:image') ?? meta.get('twitter:image:src'), 'twitter', 0.85, {
    alt: twitterAlt,
  });
  if (main) {
    for (const image of ldImages(ld, main.image)) addImage(image.url, 'jsonld', 0.85, image);
    for (const image of ldImages(ld, main.thumbnailUrl))
      addImage(image.url, 'jsonld', 0.6, image, 'thumbnail');
  }
  addImage(meta.get('parsely-image-url'), 'parsely', 0.7);
  addImage(meta.get('sailthru.image.full'), 'sailthru', 0.7);
  addImage(links.imageSrc, 'link', 0.6);
  for (const image of html.articleImages.slice(0, 1))
    addImage(image.url, 'html', 0.4, image, 'article-img');
  const images = rank(imageRaw, { key: (r) => r.url, limit: 8 });

  // ---- Logos (page metadata only; header logos and validation arrive with M8) -------------------
  const logoRaw: Candidate<LogoRef>[] = [];
  const addLogo = (
    url: string | null | undefined,
    kind: LogoRef['kind'],
    source: SourceId,
    score: number,
    extra: Partial<LogoRef> = {},
  ) => {
    const resolved = resolveUrl(url, base, { allowDataImage: true });
    if (resolved) logoRaw.push({ value: { url: resolved, kind, ...extra }, source, score });
  };
  if (ctx.outlet?.logo?.wordmark)
    addLogo(ctx.outlet.logo.wordmark.url, 'wordmark', 'registry', 1.0);
  if (ctx.outlet?.logo?.icon) addLogo(ctx.outlet.logo.icon.url, 'icon', 'registry', 0.9);
  const ldLogos = [publisher.logo, ...ldOrganizationLogos(ld)].filter(
    (l): l is NonNullable<typeof l> => !!l,
  );
  for (const logo of ldLogos.slice(0, 2)) {
    const kind: LogoRef['kind'] =
      logo.width && logo.height && logo.width / logo.height < 1.8 ? 'icon' : 'wordmark';
    addLogo(logo.url, kind, 'jsonld', 0.7, { width: logo.width, height: logo.height });
  }
  const bySize = (a: { size: number }, b: { size: number }) => b.size - a.size;
  const mask = links.icons.find((i) => i.rel === 'mask-icon');
  if (mask)
    addLogo(mask.url, 'icon', 'link', 0.65, { tint: normalizeColor(mask.color) ?? undefined });
  const touch = links.icons.filter((i) => i.rel === 'apple-touch-icon').sort(bySize)[0];
  if (touch)
    addLogo(touch.url, 'icon', 'link', 0.55, {
      width: touch.size || undefined,
      height: touch.size || undefined,
    });
  const favicon = links.icons
    .filter((i) => i.rel === 'icon')
    .filter((i) => (i.type ?? '').includes('svg') || /\.svg(\?|$)/i.test(i.url) || i.size >= 64)
    .sort(bySize)[0];
  if (favicon) addLogo(favicon.url, 'favicon', 'link', 0.5);
  try {
    addLogo(new URL('/favicon.ico', ctx.pageUrl).href, 'favicon', 'heuristic', 0.3);
  } catch {
    // no page origin to guess from
  }
  const logos = rank(logoRaw, { key: (l) => l.url, limit: 8 });

  // ---- Colours -------------------------------------------------------------------------------
  const colorRaw: Candidate<string>[] = [];
  const addColor = (
    value: string | null | undefined,
    source: SourceId,
    score: number,
    note?: string,
  ) => {
    const hex = normalizeColor(value);
    if (hex) colorRaw.push({ value: hex, source, score, note });
  };
  addColor(ctx.outlet?.colors?.brand, 'registry', 1.0);
  for (const entry of meta.entriesFor('theme-color')) {
    const dark = /prefers-color-scheme\s*:\s*dark/i.test(entry.media ?? '');
    addColor(entry.value, 'meta', dark ? 0.4 : 0.75, 'theme-color');
  }
  if (mask?.color) addColor(mask.color, 'link', 0.7, 'mask-icon');
  addColor(meta.get('msapplication-tilecolor'), 'meta', 0.65, 'tile-color');
  const colors = rank(colorRaw, { key: (c) => c, limit: 6 });

  // ---- Language and direction ----------------------------------------------------------------
  const hints = [meta.get('og:locale'), main ? ldString(main.inLanguage) : undefined]
    .filter((x): x is string => !!x)
    .map(primarySubtag)
    .filter((x) => /^[a-z]{2,3}$/.test(x));
  const agreeing = hints.length > 0 && hints.every((h) => h === hints[0]);
  const lang = agreeing ? hints[0] : html.lang ? primarySubtag(html.lang) || undefined : undefined;
  const dir: 'ltr' | 'rtl' | undefined =
    html.dir === 'rtl' ||
    (lang && RTL_LANGUAGES.has(lang)) ||
    (title[0] && mostlyRtl(title[0].value))
      ? 'rtl'
      : lang || html.dir
        ? 'ltr'
        : undefined;

  const flags: Extraction['flags'] = { ogType: meta.get('og:type') };
  const free = main ? truthyFlag(resolveRef(ld, main.isAccessibleForFree)) : undefined;
  if (free !== undefined) flags.isAccessibleForFree = free;

  return {
    pageUrl: ctx.pageUrl,
    lang,
    dir,
    title,
    description,
    kicker,
    siteName,
    authors,
    published,
    modified,
    images,
    logos,
    colors,
    canonical: canonicalCandidates,
    links: {
      manifest: links.manifest,
      feeds: links.feeds,
      oembed: links.oembed,
      amp: links.amp,
    },
    flags,
    warnings,
  };
}
