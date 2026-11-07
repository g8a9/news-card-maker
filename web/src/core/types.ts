// Data model shared by extraction, pipeline, rendering and UI (PLAN.md §5.9).

export type SourceId =
  | 'adapter'
  | 'jsonld'
  | 'og'
  | 'twitter'
  | 'article'
  | 'microdata'
  | 'parsely'
  | 'sailthru'
  | 'dc'
  | 'citation'
  | 'meta'
  | 'html'
  | 'link'
  | 'manifest'
  | 'feed'
  | 'wayback'
  | 'registry'
  | 'url'
  | 'heuristic'
  | 'user';

export interface Candidate<T> {
  value: T;
  source: SourceId;
  score: number;
  note?: string;
}

/** A calendar date as written by the source, in the source's own UTC offset. */
export interface PartialDate {
  raw: string;
  y: number;
  m: number;
  d: number;
  hh?: number;
  mi?: number;
  /** Minutes east of UTC, or null when the source gave no offset (publisher-local time). */
  offsetMin: number | null;
}

export interface ImageRef {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
  mime?: string;
}

export type LogoKind = 'wordmark' | 'icon' | 'favicon' | 'monogram';

export interface LogoRef extends ImageRef {
  kind: LogoKind;
  /** Serialised inline SVG from the page header (M8). */
  svgMarkup?: string;
  /** Tint suggested by the source, for example a mask-icon `color`. */
  tint?: string;
}

/** Output of the pure `extract()` function: every candidate, with its source and score. */
export interface Extraction {
  pageUrl: string;
  lang?: string;
  dir?: 'ltr' | 'rtl';
  title: Candidate<string>[];
  description: Candidate<string>[];
  kicker: Candidate<string>[];
  siteName: Candidate<string>[];
  authors: Candidate<string[]>[];
  published: Candidate<PartialDate>[];
  modified: Candidate<PartialDate>[];
  images: Candidate<ImageRef>[];
  logos: Candidate<LogoRef>[];
  colors: Candidate<string>[];
  canonical: Candidate<string>[];
  links: { manifest?: string; feeds: string[]; oembed?: string; amp?: string };
  flags: { isAccessibleForFree?: boolean; ogType?: string };
  warnings: string[];
}

/** A field with its ranked alternatives and the user's edit, if any. */
export interface Field<T> {
  value: T | null;
  options: Candidate<T>[];
  /** User edit. `undefined` means "use value". */
  override?: T | null;
}

export interface LoadedImage {
  ref: ImageRef;
  objectUrl: string;
  width: number;
  height: number;
  palette?: string[];
}

export interface LogoAnalysis {
  aspect: number;
  alphaCoverage?: number;
  bgColor?: string;
  colors?: string[];
  isMonochrome?: boolean;
  fgLuminance?: number;
  entropy?: number;
}

export interface LoadedLogo {
  ref: LogoRef;
  objectUrl: string;
  width: number;
  height: number;
  analysis?: LogoAnalysis;
}

export type Provenance =
  | 'proxy'
  | 'adapter'
  | 'feed'
  | 'wayback'
  | 'bookmarklet'
  | 'paste'
  | 'manual';

export interface ArticleModel {
  inputUrl: string;
  finalUrl: string;
  /** The URL printed on the card: canonical when trustworthy, cleaned of tracking parameters. */
  citeUrl: string;
  provenance: Provenance[];
  status: 'ok' | 'partial' | 'blocked';
  blockReason?: string;
  /** Why a page counts as blocked: challenge, paywall-wall, geo, consent-wall, not-html or no-metadata. */
  blockKind?: string;
  fields: {
    title: Field<string>;
    description: Field<string>;
    kicker: Field<string>;
    siteName: Field<string>;
    authors: Field<string[]>;
    published: Field<PartialDate>;
    modified: Field<PartialDate>;
    image: Field<LoadedImage>;
    logo: Field<LoadedLogo>;
  };
  /** Image and logo references found on the page, loaded lazily into the fields above. */
  imageCandidates: Candidate<ImageRef>[];
  logoCandidates: Candidate<LogoRef>[];
  brand: { outletId?: string; color?: string; paper?: string; palette: string[] };
  lang?: string;
  dir: 'ltr' | 'rtl';
  extras?: { hn?: { points: number; comments: number; by: string; linkUrl?: string } };
}

/** The value a card should show for a field: the user's edit, else the chosen candidate. */
export function effective<T>(field: Field<T>): T | null {
  return field.override !== undefined ? field.override : field.value;
}
