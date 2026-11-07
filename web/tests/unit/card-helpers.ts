import type {
  ArticleModel,
  Candidate,
  LoadedImage,
  LoadedLogo,
  PartialDate,
} from '../../src/core/types.ts';

const field = <T>(value: T | null): { value: T | null; options: Candidate<T>[] } => ({
  value,
  options: value === null ? [] : [{ value, source: 'user', score: 1 }],
});

export const day = (y: number, m: number, d: number): PartialDate => ({
  raw: `${y}-${m}-${d}`,
  y,
  m,
  d,
  offsetMin: null,
});

export const loadedImage = (url = 'blob:test/image'): LoadedImage => ({
  ref: { url: 'https://img.test/a.jpg' },
  objectUrl: url,
  width: 1600,
  height: 840,
});

export const loadedLogo = (
  kind: 'wordmark' | 'icon' | 'favicon' = 'wordmark',
  url = 'blob:test/logo',
): LoadedLogo => ({
  ref: { url: 'https://img.test/logo.png', kind },
  objectUrl: url,
  width: kind === 'wordmark' ? 380 : 128,
  height: kind === 'wordmark' ? 120 : 128,
  analysis: { aspect: kind === 'wordmark' ? 3.1 : 1 },
});

export function makeModel(
  over: Partial<{
    title: string | null;
    description: string | null;
    kicker: string | null;
    siteName: string | null;
    authors: string[] | null;
    published: PartialDate | null;
    modified: PartialDate | null;
    image: LoadedImage | null;
    logo: LoadedLogo | null;
    citeUrl: string;
    lang: string | undefined;
    dir: 'ltr' | 'rtl';
    brand: string | undefined;
    paper: string | undefined;
  }> = {},
): ArticleModel {
  const o = {
    title: 'Council approves harbour tram line after late vote',
    description: 'Councillors backed the scheme by 31 votes to 29.',
    kicker: 'Transport',
    siteName: 'The Courier',
    authors: ['Jane Roe'],
    published: day(2026, 11, 6),
    modified: null,
    image: loadedImage(),
    logo: loadedLogo(),
    citeUrl: 'https://www.thecourier.test/transport/2026/nov/06/council-approves-harbour-tram-line',
    lang: 'en',
    dir: 'ltr' as const,
    brand: '#052962',
    paper: undefined,
    ...over,
  };
  return {
    inputUrl: o.citeUrl,
    finalUrl: o.citeUrl,
    citeUrl: o.citeUrl,
    provenance: ['proxy'],
    status: 'ok',
    fields: {
      title: field(o.title),
      description: field(o.description),
      kicker: field(o.kicker),
      siteName: field(o.siteName),
      authors: field(o.authors),
      published: field(o.published),
      modified: field(o.modified),
      image: field(o.image),
      logo: field(o.logo),
    },
    imageCandidates: [],
    logoCandidates: [],
    brand: { color: o.brand, paper: o.paper, palette: o.brand ? [o.brand] : [] },
    lang: o.lang,
    dir: o.dir,
  };
}
