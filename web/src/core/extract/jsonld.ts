// JSON-LD parsing (PLAN.md §5.4): lenient parsing, @graph / @id flattening, main-entity choice.
import { comparableUrl } from '../url.ts';

export type LdNode = Record<string, unknown>;

export interface LdData {
  nodes: LdNode[];
  byId: Map<string, LdNode>;
  warnings: string[];
}

const ARTICLE_TYPES = new Set(
  [
    'NewsArticle',
    'Article',
    'ReportageNewsArticle',
    'AnalysisNewsArticle',
    'OpinionNewsArticle',
    'BackgroundNewsArticle',
    'ReviewNewsArticle',
    'BlogPosting',
    'LiveBlogPosting',
    'TechArticle',
    'ScholarlyArticle',
    'Report',
    'SocialMediaPosting',
    'VideoObject', // treated as article-like
  ].map((t) => t.toLowerCase()),
);

const isObject = (v: unknown): v is LdNode =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function parseLenient(text: string): unknown {
  const stripped = text
    .replace(/^\s*<!--/, '')
    .replace(/-->\s*$/, '')
    .replace(/^\s*\/\/\s*<!\[CDATA\[/, '')
    .replace(/\/\/\s*\]\]>\s*$/, '')
    .replace(/^\s*<!\[CDATA\[/, '')
    .replace(/\]\]>\s*$/, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // Second chance: trailing commas and raw control characters inside strings.
    const repaired = stripped
      .replace(/,\s*([}\]])/g, '$1')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: raw control characters are the thing being repaired
      .replace(/[\u0000-\u001f]+/g, ' ');
    return JSON.parse(repaired);
  }
}

/** Collects every node, flattening top-level arrays, @graph and nested mainEntity. */
function flatten(value: unknown, out: LdNode[], depth = 0): void {
  if (depth > 6) return;
  if (Array.isArray(value)) {
    for (const item of value) flatten(item, out, depth + 1);
    return;
  }
  if (!isObject(value)) return;
  out.push(value);
  if ('@graph' in value) flatten(value['@graph'], out, depth + 1);
  if (isObject(value.mainEntity) || Array.isArray(value.mainEntity))
    flatten(value.mainEntity, out, depth + 1);
}

export function collectJsonLd(doc: Document): LdData {
  const nodes: LdNode[] = [];
  const warnings: string[] = [];
  for (const script of doc.querySelectorAll('script')) {
    const type = (script.getAttribute('type') ?? '').toLowerCase();
    if (!type.startsWith('application/ld+json')) continue;
    const text = script.textContent ?? '';
    if (!text.trim()) continue;
    try {
      flatten(parseLenient(text), nodes);
    } catch {
      warnings.push('jsonld-parse-failed');
    }
  }
  const byId = new Map<string, LdNode>();
  for (const node of nodes) {
    const id = node['@id'];
    // Keep the richest node when an @id appears twice (a stub reference and the full node).
    if (typeof id === 'string') {
      const existing = byId.get(id);
      if (!existing || Object.keys(node).length > Object.keys(existing).length) byId.set(id, node);
    }
  }
  return { nodes, byId, warnings };
}

export function typesOf(node: LdNode): string[] {
  const t = node['@type'];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string');
}

export const isArticleNode = (node: LdNode): boolean =>
  typesOf(node).some((t) => ARTICLE_TYPES.has(t.toLowerCase().replace(/^.*[/#]/, '')));

const isWebPage = (node: LdNode): boolean =>
  typesOf(node).some((t) => /^(webpage|itempage|collectionpage)$/i.test(t));

/** Resolves a `{ "@id": … }` reference one level deep. */
export function resolveRef(data: LdData, value: unknown): unknown {
  if (isObject(value) && typeof value['@id'] === 'string' && Object.keys(value).length <= 2) {
    return data.byId.get(value['@id']) ?? value;
  }
  return value;
}

/**
 * The node that describes the page's article. First matching rule wins:
 * 1. article node whose url / mainEntityOfPage matches the canonical or final URL,
 * 2. first article node with a headline, 3. first article node, 4. a WebPage with a headline or name.
 */
export function pickMainEntity(data: LdData, urls: string[]): LdNode | null {
  const wanted = new Set(urls.filter(Boolean).map(comparableUrl));
  const articles = data.nodes.filter(isArticleNode);
  const urlOf = (node: LdNode): string[] => {
    const main = node.mainEntityOfPage;
    const candidates = [node.url, isObject(main) ? (main['@id'] ?? main.url) : main];
    return candidates.filter((c): c is string => typeof c === 'string');
  };
  const byUrl = articles.find((node) => urlOf(node).some((u) => wanted.has(comparableUrl(u))));
  if (byUrl) return byUrl;
  const withHeadline = articles.find(
    (node) => typeof node.headline === 'string' && node.headline.trim(),
  );
  if (withHeadline) return withHeadline;
  if (articles[0]) return articles[0];
  return (
    data.nodes.find(
      (n) => isWebPage(n) && (typeof n.headline === 'string' || typeof n.name === 'string'),
    ) ?? null
  );
}

// ---- Field readers -------------------------------------------------------------------------------

export function ldString(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(ldString).find((v) => v);
  if (isObject(value)) return ldString(value['@value'] ?? value.name ?? value.text);
  return undefined;
}

export interface LdImage {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
}

const num = (v: unknown): number | undefined => {
  const n =
    typeof v === 'string' || typeof v === 'number' ? Number.parseInt(String(v), 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** `image` may be a string, an ImageObject or an array of either. */
export function ldImages(data: LdData, value: unknown): LdImage[] {
  const out: LdImage[] = [];
  const visit = (v: unknown, depth: number): void => {
    if (depth > 3) return;
    const resolved = resolveRef(data, v);
    if (typeof resolved === 'string') {
      if (resolved.trim()) out.push({ url: resolved.trim() });
    } else if (Array.isArray(resolved)) {
      for (const item of resolved) visit(item, depth + 1);
    } else if (isObject(resolved)) {
      const url = ldString(resolved.url ?? resolved.contentUrl ?? resolved['@id']);
      if (url) {
        out.push({
          url,
          width: num(resolved.width),
          height: num(resolved.height),
          alt: ldString(resolved.caption ?? resolved.description ?? resolved.name),
        });
      }
    }
  };
  visit(value, 0);
  return out;
}

/** Person and Organization names from `author`; strings, objects, arrays and @id references. */
export function ldAuthors(data: LdData, value: unknown): string[] {
  const names: string[] = [];
  const visit = (v: unknown, depth: number): void => {
    if (depth > 3) return;
    const resolved = resolveRef(data, v);
    if (typeof resolved === 'string') {
      if (resolved.trim() && !/^https?:/i.test(resolved)) names.push(resolved.trim());
    } else if (Array.isArray(resolved)) {
      for (const item of resolved) visit(item, depth + 1);
    } else if (isObject(resolved)) {
      const name = ldString(resolved.name);
      if (name) names.push(name);
    }
  };
  visit(value, 0);
  return names;
}

export function ldPublisher(data: LdData, node: LdNode): { name?: string; logo?: LdImage } {
  const publisher = resolveRef(data, node.publisher);
  const org = Array.isArray(publisher) ? resolveRef(data, publisher[0]) : publisher;
  if (!isObject(org)) return {};
  return { name: ldString(org.name), logo: ldImages(data, org.logo)[0] };
}

/** `Organization.logo` outside of the article's `publisher` (Bloomberg has one on the Organization). */
export function ldOrganizationLogos(data: LdData): LdImage[] {
  const out: LdImage[] = [];
  for (const node of data.nodes) {
    if (typesOf(node).some((t) => /^(organization|newsmediaorganization|corporation)$/i.test(t))) {
      out.push(...ldImages(data, node.logo));
    }
  }
  return out;
}
