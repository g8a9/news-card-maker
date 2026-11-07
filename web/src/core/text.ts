// Text normalisation and the small heuristics that depend on it (PLAN.md §5.5, §5.6.2, §5.6.3).

// ---- Entities and clean-up ---------------------------------------------------------------------

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

/** Fallback for runtimes without DOMParser: numeric entities and a handful of named ones. */
function decodeBasic(s: string): string {
  return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, dec, hex, name) => {
    if (dec || hex) {
      const code = dec ? Number(dec) : Number.parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED[(name as string).toLowerCase()] ?? match;
  });
}

let parser: DOMParser | undefined;

/** Decodes entities through an inert textarea: RCDATA decodes entities and never builds markup. */
function decodeOnce(s: string): string {
  if (typeof DOMParser === 'undefined') return decodeBasic(s);
  parser ??= new DOMParser();
  const escaped = s.replace(/<\//g, '&lt;/');
  const doc = parser.parseFromString(`<!doctype html><textarea>${escaped}</textarea>`, 'text/html');
  return doc.querySelector('textarea')?.value ?? decodeBasic(s);
}

const ENTITY_PATTERN = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]{1,31});/i;

/** Decodes HTML entities, a second time when the first pass leaves some (double encoding). */
export function decodeEntities(input: string): string {
  let out = input;
  for (let pass = 0; pass < 2 && out.includes('&') && ENTITY_PATTERN.test(out); pass++) {
    out = decodeOnce(out);
  }
  return out;
}

/** NFC, entities decoded, zero-width characters and soft hyphens removed, whitespace collapsed. */
export function cleanText(input: string): string {
  return decodeEntities(input).normalize('NFC').replace(/[​-‍⁠﻿­]/g, '').replace(/\s+/g, ' ').trim();
}

/** Removes tags from a string that should be plain text (feed descriptions, sloppy meta tags). */
export function stripTags(input: string): string {
  return cleanText(input.replace(/<[^>]*>/g, ' '));
}

export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  const cut = input.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:–—-]+$/, '')}…`;
}

// ---- Matching ------------------------------------------------------------------------------------

const LEADING_ARTICLE = /^(?:the|la|il|lo|le|les|el|los|las|der|die|das|l'|un|une)\s+/i;

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Removes accents from Latin-style scripts. Kana and Hangul keep their marks (ボ is not ホ). */
function stripAccents(input: string): string {
  return CJK.test(input) ? input.normalize('NFC') : input.normalize('NFKD').replace(/\p{M}+/gu, '');
}

/** Lower-case, diacritic-free, article-free, letters and digits only: for comparing names. */
export function fold(input: string): string {
  return stripAccents(input)
    .toLowerCase()
    .replace(LEADING_ARTICLE, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Word tokens; runs of CJK characters become bigrams because they have no spaces. */
export function tokens(input: string): string[] {
  const out: string[] = [];
  for (const word of input.toLowerCase().match(/[\p{L}\p{N}\p{M}]+/gu) ?? []) {
    if (CJK.test(word)) {
      const chars = [...word.normalize('NFC')];
      if (chars.length === 1) out.push(chars[0] as string);
      for (let i = 0; i < chars.length - 1; i++)
        out.push((chars[i] as string) + (chars[i + 1] as string));
    } else {
      out.push(stripAccents(word));
    }
  }
  return out;
}

/** Share of `a`'s tokens that also appear in `b` (0–1). */
export function tokenOverlap(a: string, b: string): number {
  const ta = tokens(a);
  if (ta.length === 0) return 0;
  const tb = new Set(tokens(b));
  return ta.filter((t) => tb.has(t)).length / ta.length;
}

export const wordCount = (s: string): number =>
  s.trim() === '' ? 0 : s.trim().split(/\s+/).length;

// ---- Title suffix stripping (§5.6.3) -------------------------------------------------------------

const SEPARATORS = [' | ', ' - ', ' – ', ' — ', ' · ', ' • ', ' :: ', ' » ', ' / '];
const GENERIC_NOISE = ['home', 'news', 'latest news'];

export interface SuffixContext {
  /** Strong sources for the headline (validated h1, JSON-LD headline). */
  anchors: string[];
  siteNames: string[];
  hostLabels: string[];
  sections: string[];
  registrySuffixes: string[];
}

/** Position and length of the right-most separator in `s`, or null. */
function lastSeparator(s: string): { at: number; length: number } | null {
  let best: { at: number; length: number } | null = null;
  for (const sep of SEPARATORS) {
    const at = s.lastIndexOf(sep);
    if (at > 0 && (!best || at > best.at)) best = { at, length: sep.length };
  }
  return best;
}

export function stripTitleSuffix(candidate: string, ctx: SuffixContext): string {
  const original = candidate.trim();

  // 1. A trusted headline followed by a separator and more text: the trusted headline wins.
  for (const anchor of ctx.anchors) {
    if (original.length > anchor.length && original.startsWith(anchor)) {
      const next = SEPARATORS.find((sep) => original.startsWith(sep, anchor.length));
      if (next) return anchor;
    }
  }

  const noise = [
    ...ctx.siteNames,
    ...ctx.hostLabels,
    ...ctx.sections,
    ...ctx.registrySuffixes.map((s) => s.replace(/^[\s|\-–—·•:»/]+/, '')),
    ...GENERIC_NOISE,
  ]
    .map(fold)
    .filter((n) => n.length > 0);
  const hostFolded = ctx.hostLabels.map(fold).filter((n) => n.length >= 3);

  const isNoise = (segment: string): boolean => {
    const f = fold(segment);
    if (!f) return false;
    if (noise.includes(f)) return true;
    return f.length >= 3 && hostFolded.some((h) => h.includes(f));
  };

  // 2. Drop trailing segments that are the site name, its domain, the section, or a known suffix.
  // 3. Never strip from the front: "Opinion | …" is a kicker, not noise.
  let current = original;
  for (;;) {
    const sep = lastSeparator(current);
    if (!sep) break;
    const tail = current.slice(sep.at + sep.length);
    if (!isNoise(tail)) break;
    current = current.slice(0, sep.at).trim();
  }

  // 4. Keep the result only if enough of the headline survived.
  if (current === original) return original;
  return wordCount(current) >= 3 || current.length >= original.length * 0.5 ? current : original;
}

// ---- Authors, legal entities ------------------------------------------------------------------

/**
 * Appendix B.4: legal-entity suffixes mark a company name, not a brand. Also catches corporate words
 * anywhere in the name ("Nature Publishing Group UK" is the publisher, not the brand "Nature").
 */
const LEGAL_ENTITY =
  /(?:\b(?:S\.?A\.?|S\.?L\.?|S\.?p\.?A\.?|S\.?r\.?l\.?|Ltd\.?|Limited|LLC|L\.L\.C\.|Inc\.?|Corp\.?|Corporation|GmbH|AG|SE|B\.?V\.?|N\.?V\.?|PLC|Pty|Co\.?)|\bMedia Group|\bPublishing|\bPublishers|\bHoldings|\bGroup)(?:\s+(?:UK|US|USA|EU|Ltd|Limited|Inc))?\s*$|\b(?:Publishing|Publishers) Group\b/i;

export const isLegalEntityName = (name: string): boolean => LEGAL_ENTITY.test(name.trim());

const INSTITUTIONAL =
  /\b(?:staff|redazione|agenzia|newsroom|editorial|desk|reuters|associated press|afp)\b/i;

export function isInstitutionalAuthor(name: string, siteNames: string[]): boolean {
  const f = fold(name);
  if (siteNames.some((s) => fold(s) === f)) return true;
  return INSTITUTIONAL.test(name);
}

/** "By A, B and C" → ["A", "B", "C"]. Strips bylines in several languages. */
export function splitAuthors(input: string): string[] {
  const text = cleanText(input)
    .replace(/^(?:by|di|par|von|por|de)\s+/i, '')
    .replace(/\s+\|.*$/, '');
  return text
    .split(/\s*(?:,|;|\s&\s|\s(?:and|e|y|und|et)\s)\s*/i)
    .map((n) => n.replace(/^(?:by|di|par|von|por|de)\s+/i, '').trim())
    .filter((n) => n.length > 1 && n.length < 80 && !/^https?:/i.test(n));
}

export function formatAuthors(names: string[], locale?: string): string {
  if (names.length === 0) return '';
  if (names.length > 3) return `${names[0]} et al.`;
  try {
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names);
  } catch {
    return names.join(', ');
  }
}

// ---- Misc -------------------------------------------------------------------------------------------

const JUNK_SECTIONS = new Set([
  'tags',
  'news',
  'home',
  'article',
  'articles',
  'story',
  'stories',
  'content',
  'general',
  'default',
  'uncategorized',
]);

export const isJunkSection = (value: string): boolean =>
  value.trim().length <= 1 || JUNK_SECTIONS.has(value.trim().toLowerCase());

/** True when most letters are Arabic or Hebrew script (for direction detection). */
export function mostlyRtl(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return false;
  const rtl = letters.filter((c) => /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(c)).length;
  return rtl / letters.length > 0.5;
}
