import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assessPage } from '../../src/core/blocked.ts';
import { decodeBytes } from '../../src/core/charset.ts';
import { toIsoDate } from '../../src/core/dates.ts';
import { extract } from '../../src/core/extract/index.ts';
import type { Outlet } from '../../src/core/registry.ts';
import type { Candidate, Extraction, PartialDate } from '../../src/core/types.ts';

/** The clock for every test: 2026-11-07 12:00 UTC, so the date sanity window is deterministic. */
export const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);

export const FIXTURE_DIR = join(import.meta.dirname, '..', 'fixtures', 'pages');

export interface FixtureMeta {
  pageUrl: string;
  inputUrl: string;
  status?: number;
  contentType?: string;
}

export function readFixture(file: string): { bytes: Uint8Array; meta: FixtureMeta } {
  const bytes = new Uint8Array(readFileSync(join(FIXTURE_DIR, file)));
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 2000));
  const m = /^<!-- fixture (.*) -->/.exec(head);
  if (!m) throw new Error(`${file}: missing fixture header`);
  return { bytes, meta: JSON.parse(m[1] as string) as FixtureMeta };
}

export const parseHtml = (html: string): Document =>
  new DOMParser().parseFromString(html, 'text/html');

export function extractFixture(file: string, outlet?: Outlet | null) {
  const { bytes, meta } = readFixture(file);
  const decoded = decodeBytes(bytes, meta.contentType ?? 'text/html');
  const doc = parseHtml(decoded.text);
  const extraction = extract(doc, {
    pageUrl: meta.pageUrl,
    inputUrl: meta.inputUrl,
    outlet,
    now: NOW,
  });
  const verdict = assessPage(
    {
      upstreamStatus: meta.status ?? 200,
      upstreamContentType: meta.contentType ?? 'text/html',
      finalUrl: meta.pageUrl,
      inputUrl: meta.inputUrl,
      title: doc.title,
      bodyText: decoded.text,
    },
    extraction,
  );
  return { extraction, verdict, decoded, meta, doc };
}

const compact = <T>(list: Candidate<T>[], show: (v: T) => unknown) =>
  list.map((c) => [show(c.value), c.source, c.score, ...(c.note ? [c.note] : [])]);

const dateText = (d: PartialDate): string => {
  const time =
    d.hh === undefined
      ? ''
      : ` ${String(d.hh).padStart(2, '0')}:${String(d.mi ?? 0).padStart(2, '0')}`;
  const offset = d.offsetMin === null ? ' local' : ` off=${d.offsetMin}`;
  return `${toIsoDate(d)}${time}${d.hh === undefined ? '' : offset}`;
};

/** A compact, stable projection of an Extraction for snapshot files. */
export function summarize(e: Extraction) {
  return {
    lang: e.lang ?? null,
    dir: e.dir ?? null,
    title: compact(e.title, (v) => v),
    description: compact(e.description, (v) => v),
    kicker: compact(e.kicker, (v) => v),
    siteName: compact(e.siteName, (v) => v),
    authors: compact(e.authors, (v) => v),
    published: compact(e.published, dateText),
    modified: compact(e.modified, dateText),
    images: compact(e.images, (v) => (v.width ? `${v.url} [${v.width}x${v.height}]` : v.url)),
    logos: compact(e.logos, (v) => `${v.kind}: ${v.url}${v.tint ? ` tint=${v.tint}` : ''}`),
    colors: compact(e.colors, (v) => v),
    canonical: compact(e.canonical, (v) => v),
    links: e.links,
    flags: e.flags,
    warnings: e.warnings,
  };
}
