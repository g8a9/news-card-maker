// Hacker News adapter (PLAN.md §5.8). HN pages carry no metadata beyond <title>, so the item comes
// from the Firebase API, which sends CORS headers (the browser calls it directly).
import type { Extraction, SourceId } from '../../core/types.ts';

const ITEM_URL = /^https?:\/\/news\.ycombinator\.com\/item\?id=(\d+)/i;
const API = 'https://hacker-news.firebaseio.com/v0/item';

export const HN_BRAND = '#FF6600';
export const HN_LOGO = 'https://news.ycombinator.com/y18.svg';

export interface HnItem {
  id: number;
  type?: string;
  by?: string;
  time?: number;
  title?: string;
  url?: string;
  text?: string;
  score?: number;
  descendants?: number;
  parent?: number;
  dead?: boolean;
  deleted?: boolean;
}

export class HnError extends Error {
  readonly code: 'comment' | 'not-found' | 'unavailable';
  readonly parentUrl?: string;
  constructor(code: HnError['code'], message: string, parentUrl?: string) {
    super(message);
    this.name = 'HnError';
    this.code = code;
    this.parentUrl = parentUrl;
  }
}

/** The item id when `url` is a Hacker News item page. */
export function matchHn(url: string): string | null {
  return ITEM_URL.exec(url)?.[1] ?? null;
}

export async function fetchHnItem(
  id: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<HnItem> {
  let res: Response;
  try {
    res = await fetchImpl(`${API}/${id}.json`, { signal });
  } catch {
    throw new HnError('unavailable', 'Hacker News did not answer');
  }
  if (!res.ok) throw new HnError('unavailable', `Hacker News answered ${res.status}`);
  const item = (await res.json()) as HnItem | null;
  if (!item || item.deleted || item.dead)
    throw new HnError('not-found', 'That item no longer exists');
  return item;
}

const PREFIX = /^(show hn|ask hn|launch hn|tell hn)\s*:\s*/i;

const candidate = <T>(value: T, source: SourceId = 'adapter') => [{ value, source, score: 1 }];

/** Maps an item to the same Extraction shape the generic extractor produces. */
export function hnToExtraction(item: HnItem, pageUrl: string): Extraction {
  if (item.type === 'comment') {
    throw new HnError(
      'comment',
      'This is a comment, open its story instead',
      item.parent ? `https://news.ycombinator.com/item?id=${item.parent}` : undefined,
    );
  }
  const rawTitle = (item.title ?? '').trim();
  const prefix = PREFIX.exec(rawTitle);
  const title = prefix ? rawTitle.slice(prefix[0].length) : rawTitle;

  let linkHost: string | undefined;
  try {
    if (item.url) linkHost = new URL(item.url).hostname.replace(/^www\./, '');
  } catch {
    // an unparseable story URL just means no subtitle
  }

  const date = item.time ? new Date(item.time * 1000) : null;
  return {
    pageUrl,
    lang: 'en',
    dir: 'ltr',
    title: title ? candidate(title) : [],
    description: linkHost ? candidate(linkHost) : [],
    kicker: prefix
      ? candidate(
          (prefix[1] as string).replace(/\bhn\b/i, 'HN').replace(/^./, (c) => c.toUpperCase()),
        )
      : [],
    siteName: candidate('Hacker News'),
    authors: item.by ? candidate([item.by]) : [],
    published: date
      ? candidate({
          raw: String(item.time),
          y: date.getUTCFullYear(),
          m: date.getUTCMonth() + 1,
          d: date.getUTCDate(),
          hh: date.getUTCHours(),
          mi: date.getUTCMinutes(),
          offsetMin: 0,
        })
      : [],
    modified: [],
    images: [],
    logos: candidate({ url: HN_LOGO, kind: 'icon' as const }),
    colors: candidate(HN_BRAND),
    canonical: candidate(`https://news.ycombinator.com/item?id=${item.id}`),
    links: { feeds: [] },
    flags: { ogType: 'article' },
    warnings: [],
  };
}
