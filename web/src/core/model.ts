// Turns an Extraction into the ArticleModel the editor works with (PLAN.md §3.2 steps 6, §5.5 "URLs").
// Pure: no network. Images and logos stay unloaded here; the pipeline loads and validates them.

import type { Verdict } from './blocked.ts';
import { isNeutralColor } from './color.ts';
import type { Outlet } from './registry.ts';
import type { ArticleModel, Candidate, Extraction, Field, Provenance } from './types.ts';
import { cleanCitationUrl, hostOf, isAmpUrl, sameSite } from './url.ts';

export interface BuildOptions {
  inputUrl: string;
  finalUrl: string;
  provenance: Provenance[];
  outlet?: Outlet | null;
  verdict?: Verdict;
  extras?: ArticleModel['extras'];
}

const fieldOf = <T>(options: Candidate<T>[]): Field<T> => ({
  value: options[0]?.value ?? null,
  options,
});

const emptyField = <T>(): Field<T> => ({ value: null, options: [] });

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return '/';
  }
};

/**
 * The URL printed on the card, plus the alternatives worth offering. Prefers the canonical, ignores
 * a canonical that points at a bare "/" while the input was deeper (misconfigured), and does not
 * follow a cross-domain canonical unless the registry lists that domain for the outlet.
 */
export function chooseCiteUrl(
  e: Extraction,
  inputUrl: string,
  finalUrl: string,
  outlet?: Outlet | null,
): { citeUrl: string; options: string[] } {
  const clean = cleanCitationUrl(finalUrl);
  const inputPath = pathOf(inputUrl);
  const options: string[] = [];
  let chosen: string | null = null;

  for (const candidate of e.canonical) {
    if (candidate.source === 'url') continue; // that is finalUrl itself
    const url = cleanCitationUrl(candidate.value);
    if (pathOf(url) === '/' && inputPath.length > 1) continue;
    const knownDomain = outlet?.domains.some(
      (d) => hostOf(url) === d || hostOf(url).endsWith(`.${d}`),
    );
    if (!sameSite(url, finalUrl) && !knownDomain) {
      options.push(url);
      continue;
    }
    chosen ??= url;
  }

  // An AMP address is never what you want to cite: use the canonical when there is one.
  const citeUrl = chosen && (isAmpUrl(finalUrl) || chosen !== clean) ? chosen : clean;
  if (clean !== citeUrl) options.unshift(clean);
  return { citeUrl, options: [...new Set(options)].filter((o) => o !== citeUrl) };
}

export function buildModel(e: Extraction, o: BuildOptions): ArticleModel {
  const { citeUrl } = chooseCiteUrl(e, o.inputUrl, o.finalUrl, o.outlet);
  const brandColor = e.colors.find((c) => !isNeutralColor(c.value))?.value;
  const verdict = o.verdict;

  let status: ArticleModel['status'] = 'ok';
  if (verdict?.blocked) status = 'blocked';
  else if (verdict && (!verdict.hasStructuredTitle || verdict.quality < 0.6)) status = 'partial';
  else if (!e.title.length) status = 'partial';

  return {
    inputUrl: o.inputUrl,
    finalUrl: o.finalUrl,
    citeUrl,
    provenance: o.provenance,
    status,
    blockReason: verdict?.blocked || verdict?.kind === 'no-metadata' ? verdict.reason : undefined,
    blockKind: verdict?.blocked || verdict?.kind === 'no-metadata' ? verdict.kind : undefined,
    fields: {
      title: fieldOf(e.title),
      description: fieldOf(e.description),
      kicker: fieldOf(e.kicker),
      siteName: fieldOf(e.siteName),
      authors: fieldOf(e.authors),
      published: fieldOf(e.published),
      modified: fieldOf(e.modified),
      image: emptyField(),
      logo: emptyField(),
    },
    imageCandidates: e.images,
    logoCandidates: e.logos,
    brand: {
      outletId: o.outlet?.id,
      color: brandColor,
      paper: o.outlet?.colors?.paper ?? undefined,
      palette: e.colors.map((c) => c.value),
    },
    lang: e.lang,
    dir: e.dir ?? 'ltr',
    extras: o.extras,
  };
}
