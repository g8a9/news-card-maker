// Manual mode (PLAN.md §9.2, §9.5): a card typed by hand, optionally starting from a registry outlet.
// Pure: it only builds the same Extraction the other sources produce, so everything downstream
// (model, logos, brand colour, rendering) works unchanged.
import { normalizeColor } from './color.ts';
import { parseDate } from './dates.ts';
import type { Outlet } from './registry.ts';
import { mostlyRtl } from './text.ts';
import type { Candidate, Extraction, LogoRef } from './types.ts';
import { hostOf } from './url.ts';

export interface ManualInput {
  title: string;
  description?: string;
  /** An outlet name typed by hand, used when no registry outlet applies. */
  siteName?: string;
  /** The registry outlet picked by the user. */
  outletId?: string | null;
  /** An http(s) address to print on the card; optional. */
  url?: string;
  /** `yyyy-mm-dd` from a date input, or anything `parseDate` understands. */
  date?: string;
}

const typed = <T>(value: T): Candidate<T>[] => [{ value, source: 'user', score: 1 }];

export function manualExtraction(
  input: ManualInput,
  outlet: Outlet | null,
  now: number = Date.now(),
): Extraction {
  const title = input.title.trim();
  const description = input.description?.trim() ?? '';
  const url = input.url?.trim() ?? '';
  const typedName = input.siteName?.trim() ?? '';
  const host = url ? hostOf(url).replace(/^(www|m|amp)\./, '') : '';
  const published = input.date ? parseDate(input.date, now) : null;

  const siteName: Candidate<string>[] = outlet
    ? [{ value: outlet.name, source: 'registry', score: 1 }]
    : typedName
      ? typed(typedName)
      : host
        ? [{ value: host, source: 'url', score: 0.2 }]
        : [];

  const logos: Candidate<LogoRef>[] = [];
  if (outlet?.logo?.wordmark)
    logos.push({
      value: { url: outlet.logo.wordmark.url, kind: 'wordmark' },
      source: 'registry',
      score: 1,
    });
  if (outlet?.logo?.icon)
    logos.push({
      value: { url: outlet.logo.icon.url, kind: 'icon' },
      source: 'registry',
      score: 0.9,
    });
  const brand = normalizeColor(outlet?.colors?.brand);

  return {
    pageUrl: url,
    dir: mostlyRtl(title) ? 'rtl' : 'ltr',
    title: title ? typed(title) : [],
    description: description ? typed(description) : [],
    kicker: [],
    siteName,
    authors: [],
    published: published ? typed(published) : [],
    modified: [],
    images: [],
    logos,
    colors: brand ? [{ value: brand, source: 'registry', score: 1 }] : [],
    canonical: [],
    links: { feeds: [] },
    flags: {},
    warnings: [],
  };
}
