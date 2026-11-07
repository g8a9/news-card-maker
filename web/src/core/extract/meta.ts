// Meta-tag index (PLAN.md §5.3). Reads the whole document, not just <head>, because some
// templates put meta tags in <body>. Keys are matched case-insensitively against
// `property`, `name` and `itemprop`.

export interface MetaEntry {
  key: string;
  value: string;
  media?: string;
  /** Position in the document, to associate og:image:width with the og:image before it. */
  index: number;
}

export interface MetaIndex {
  entries: MetaEntry[];
  get(...keys: string[]): string | undefined;
  all(key: string): string[];
  entriesFor(key: string): MetaEntry[];
}

export function collectMeta(doc: Document): MetaIndex {
  const entries: MetaEntry[] = [];
  let index = 0;
  for (const el of doc.querySelectorAll('meta')) {
    const value = (el.getAttribute('content') ?? el.getAttribute('value') ?? '').trim();
    if (!value) continue;
    const media = el.getAttribute('media') ?? undefined;
    const keys = new Set<string>();
    for (const attr of ['property', 'name', 'itemprop']) {
      const v = el.getAttribute(attr)?.trim().toLowerCase();
      if (v) keys.add(v);
    }
    for (const key of keys) entries.push({ key, value, media, index });
    index++;
  }
  const byKey = new Map<string, MetaEntry[]>();
  for (const entry of entries) {
    const list = byKey.get(entry.key);
    if (list) list.push(entry);
    else byKey.set(entry.key, [entry]);
  }
  return {
    entries,
    get: (...keys) => {
      for (const key of keys) {
        const hit = byKey.get(key.toLowerCase())?.[0];
        if (hit) return hit.value;
      }
      return undefined;
    },
    all: (key) => (byKey.get(key.toLowerCase()) ?? []).map((e) => e.value),
    entriesFor: (key) => byKey.get(key.toLowerCase()) ?? [],
  };
}

export interface OgImage {
  url: string;
  secureUrl?: string;
  width?: number;
  height?: number;
  alt?: string;
}

const intOrUndefined = (v: string | undefined): number | undefined => {
  const n = v ? Number.parseInt(v, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** og:image tags with their :secure_url, :width, :height and :alt, which follow the og:image they describe. */
export function collectOgImages(meta: MetaIndex): OgImage[] {
  const images: OgImage[] = [];
  const ordered = meta.entries
    .filter((e) => e.key.startsWith('og:image'))
    .sort((a, b) => a.index - b.index);
  let current: OgImage | undefined;
  for (const { key, value } of ordered) {
    if (key === 'og:image' || key === 'og:image:url') {
      // Some sites list og:image:secure_url before og:image: attach it to the open entry instead.
      current = { url: value };
      images.push(current);
    } else if (key === 'og:image:secure_url') {
      if (current && !current.secureUrl) current.secureUrl = value;
      else {
        current = { url: value, secureUrl: value };
        images.push(current);
      }
    } else if (current && key === 'og:image:width') current.width = intOrUndefined(value);
    else if (current && key === 'og:image:height') current.height = intOrUndefined(value);
    else if (current && key === 'og:image:alt') current.alt = value;
  }
  return images;
}
