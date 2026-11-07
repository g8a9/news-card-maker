// resolve(url): the orchestration of PLAN.md §3.2 for Phase 1 (direct path, the Hacker News adapter,
// and the user-driven paths). Progressive: the card gets its text first ("content"), then images and
// logos are loaded and validated, each step emitting an update ("image", "logo"), then "done".
// Feed and Wayback fallbacks arrive in Phase 2; blocked pages end in the blocked state for now.
import { assessPage, type Verdict } from '../core/blocked.ts';
import { decodeBytes } from '../core/charset.ts';
import { extract } from '../core/extract/index.ts';
import { type ManualInput, manualExtraction } from '../core/manual.ts';
import { buildModel } from '../core/model.ts';
import { findOutlet, findOutletById, type Outlet } from '../core/registry.ts';
import type {
  ArticleModel,
  Candidate,
  Extraction,
  LoadedImage,
  LoadedLogo,
  Provenance,
} from '../core/types.ts';
import { hostOf, normalizeInput } from '../core/url.ts';
import { fetchHnItem, HnError, hnToExtraction, matchHn } from './adapters/hn.ts';
import { type ImageLoadOptions, loadImage, loadLogo } from './images.ts';
import { fetchText, ProxyRequestError, type TextResult, withRetry } from './proxy.ts';

export type PipelineStage = 'content' | 'image' | 'logo' | 'done';

export interface PipelineEvent {
  stage: PipelineStage;
  model: ArticleModel;
}

export interface PipelineOptions {
  proxyUrl: string;
  outlets?: readonly Outlet[];
  fetchImpl?: typeof fetch;
  /** Extra headers for proxy requests (Origin and Accept-Language when running under Node). */
  headers?: Record<string, string>;
  signal?: AbortSignal;
  onEvent?: (event: PipelineEvent) => void;
  /** Parser for HTML; defaults to the browser's DOMParser. */
  parseHtml?: (html: string) => Document;
  /** Load and validate images and logos after the text is ready (default true). */
  enrich?: boolean;
  decode?: ImageLoadOptions['decode'];
  now?: number;
  /** Wait before the single retry after a transient proxy failure (default 1000 ms). */
  retryDelayMs?: number;
}

export type PipelineErrorCode =
  | 'INVALID_INPUT'
  | 'PROXY_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'FETCH_FAILED'
  | 'HN_COMMENT'
  | 'HN_UNAVAILABLE';

export class PipelineError extends Error {
  readonly code: PipelineErrorCode;
  /** For HN comments: the story to open instead. */
  readonly link?: string;
  constructor(
    code: PipelineErrorCode,
    message: string,
    extra: { link?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: extra.cause });
    this.name = 'PipelineError';
    this.code = code;
    this.link = extra.link;
  }
}

const defaultParse = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

function fromProxyError(e: unknown): PipelineError {
  if (e instanceof PipelineError) return e;
  if (e instanceof ProxyRequestError) {
    if (e.code === 'RATE_LIMITED')
      return new PipelineError('RATE_LIMITED', e.message, { cause: e });
    if (e.code === 'NETWORK' || e.code === 'TIMEOUT' || e.code === 'ORIGIN_NOT_ALLOWED') {
      return new PipelineError('PROXY_UNAVAILABLE', e.message, { cause: e });
    }
    return new PipelineError('FETCH_FAILED', e.message, { cause: e });
  }
  throw e;
}

/** Fetch an article from a URL: normalise, adapter or proxy, extract, then enrich. */
export async function resolveArticle(
  input: string,
  options: PipelineOptions,
): Promise<ArticleModel> {
  const parsed = normalizeInput(input);
  if (!parsed.ok) {
    throw new PipelineError('INVALID_INPUT', 'Paste a full link, starting with https://');
  }
  const url = parsed.url;
  const outlet = findOutlet(options.outlets ?? [], hostOf(url));

  const hnId = matchHn(url);
  if (hnId) return resolveHackerNews(hnId, url, outlet, options);

  let text: TextResult;
  try {
    text = await withRetry(
      () =>
        fetchText(options.proxyUrl, url, {
          fetchImpl: options.fetchImpl,
          signal: options.signal,
          headers: options.headers,
        }),
      options.retryDelayMs ?? 1000,
      options.signal,
    );
  } catch (e) {
    throw fromProxyError(e);
  }
  return fromFetched(text, url, outlet, options);
}

/** Build a card from page source the user supplied (bookmarklet or paste). */
export async function resolveFromHtml(
  html: string,
  pageUrl: string,
  provenance: Extract<Provenance, 'bookmarklet' | 'paste'>,
  options: PipelineOptions,
): Promise<ArticleModel> {
  const outlet = findOutlet(options.outlets ?? [], hostOf(pageUrl));
  const doc = (options.parseHtml ?? defaultParse)(html);
  const extraction = extract(doc, { pageUrl, inputUrl: pageUrl, outlet, now: options.now });
  const verdict = assessPage(
    {
      upstreamStatus: 200,
      upstreamContentType: 'text/html',
      finalUrl: pageUrl,
      inputUrl: pageUrl,
      title: doc.title,
      bodyText: html.slice(0, 200_000),
    },
    extraction,
  );
  const model = buildModel(extraction, {
    inputUrl: pageUrl,
    finalUrl: pageUrl,
    provenance: [provenance],
    outlet,
    verdict,
  });
  return finish(model, options);
}

/** Build a card from fields typed by hand (manual mode). The outlet's logo and colour still load. */
export async function resolveManual(
  input: ManualInput,
  options: PipelineOptions,
): Promise<ArticleModel> {
  const outlets = options.outlets ?? [];
  let url = '';
  if (input.url?.trim()) {
    const parsed = normalizeInput(input.url);
    if (!parsed.ok) {
      throw new PipelineError('INVALID_INPUT', 'Paste a full link, starting with https://');
    }
    url = parsed.url;
  }
  const outlet =
    (input.outletId ? findOutletById(outlets, input.outletId) : null) ??
    (url ? findOutlet(outlets, hostOf(url)) : null);
  const extraction = manualExtraction({ ...input, url }, outlet, options.now);
  const model = buildModel(extraction, {
    inputUrl: url,
    finalUrl: url,
    provenance: ['manual'],
    outlet,
  });
  return finish(model, options);
}

async function fromFetched(
  text: TextResult,
  inputUrl: string,
  outlet: Outlet | null,
  options: PipelineOptions,
): Promise<ArticleModel> {
  const decoded = decodeBytes(text.bytes, text.upstreamContentType);
  const doc = (options.parseHtml ?? defaultParse)(decoded.text);
  const extraction = extract(doc, { pageUrl: text.finalUrl, inputUrl, outlet, now: options.now });
  const verdict: Verdict = assessPage(
    {
      upstreamStatus: text.upstreamStatus,
      upstreamContentType: text.upstreamContentType,
      finalUrl: text.finalUrl,
      inputUrl,
      title: doc.title,
      bodyText: decoded.text.slice(0, 400_000),
    },
    extraction,
  );
  if (text.truncated) extraction.warnings.push('page-truncated');
  const model = buildModel(extraction, {
    inputUrl,
    finalUrl: text.finalUrl,
    provenance: ['proxy'],
    outlet,
    verdict,
  });
  return finish(model, options);
}

async function resolveHackerNews(
  id: string,
  url: string,
  outlet: Outlet | null,
  options: PipelineOptions,
): Promise<ArticleModel> {
  let extraction: Extraction;
  let linkUrl: string | undefined;
  let item: Awaited<ReturnType<typeof fetchHnItem>>;
  try {
    item = await fetchHnItem(id, options.fetchImpl, options.signal);
    extraction = hnToExtraction(item, url);
    linkUrl = item.url;
  } catch (e) {
    if (e instanceof HnError) {
      throw new PipelineError(e.code === 'comment' ? 'HN_COMMENT' : 'HN_UNAVAILABLE', e.message, {
        link: e.parentUrl,
        cause: e,
      });
    }
    throw e;
  }
  const model = buildModel(extraction, {
    inputUrl: url,
    finalUrl: url,
    provenance: ['adapter'],
    outlet,
    extras: {
      hn: { points: item.score ?? 0, comments: item.descendants ?? 0, by: item.by ?? '', linkUrl },
    },
  });
  return finish(model, options);
}

/** Emit "content", then load images and logos (unless disabled), then "done". */
async function finish(model: ArticleModel, options: PipelineOptions): Promise<ArticleModel> {
  const emit = (stage: PipelineStage, m: ArticleModel) => options.onEvent?.({ stage, model: m });
  emit('content', model);
  if (options.enrich === false || model.status === 'blocked') {
    emit('done', model);
    return model;
  }

  let current = model;
  const loadOptions: ImageLoadOptions = {
    fetchImpl: options.fetchImpl,
    signal: options.signal,
    headers: options.headers,
    decode: options.decode,
  };

  const images = enrichImages(current.imageCandidates, options.proxyUrl, loadOptions, (field) => {
    current = { ...current, fields: { ...current.fields, image: field } };
    emit('image', current);
  });
  const logos = enrichLogos(current.logoCandidates, options.proxyUrl, loadOptions, (field) => {
    current = { ...current, fields: { ...current.fields, logo: field } };
    emit('logo', current);
  });
  await Promise.all([images, logos]);
  emit('done', current);
  return current;
}

async function enrichImages(
  candidates: Candidate<{ url: string }>[],
  proxy: string,
  loadOptions: ImageLoadOptions,
  onField: (field: ArticleModel['fields']['image']) => void,
): Promise<void> {
  const loaded: Array<Candidate<LoadedImage>> = [];
  await Promise.all(
    candidates.slice(0, 3).map(async (candidate) => {
      try {
        const image = await loadImage(proxy, candidate.value, loadOptions);
        loaded.push({
          value: image,
          source: candidate.source,
          score: candidate.score,
          note: candidate.note,
        });
        loaded.sort((a, b) => b.score - a.score);
        onField({ value: loaded[0]?.value ?? null, options: [...loaded] });
      } catch {
        // A broken or blocked image just drops out of the candidate list.
      }
    }),
  );
}

async function enrichLogos(
  candidates: Candidate<ArticleModel['logoCandidates'][number]['value']>[],
  proxy: string,
  loadOptions: ImageLoadOptions,
  onField: (field: ArticleModel['fields']['logo']) => void,
): Promise<void> {
  const loaded: Array<Candidate<LoadedLogo>> = [];
  await Promise.all(
    candidates.slice(0, 4).map(async (candidate) => {
      try {
        const logo = await loadLogo(proxy, candidate.value, loadOptions);
        loaded.push({
          value: logo,
          source: candidate.source,
          score: candidate.score,
          note: candidate.note,
        });
        loaded.sort((a, b) => b.score - a.score);
        onField({ value: loaded[0]?.value ?? null, options: [...loaded] });
      } catch {
        // Logos fail validation often; the next candidate or the monogram takes over.
      }
    }),
  );
}

/** Hacker News offers "Use linked article's image": run the generic pipeline on the story's URL. */
export async function loadLinkedImage(
  model: ArticleModel,
  options: PipelineOptions,
): Promise<LoadedImage | null> {
  const link = model.extras?.hn?.linkUrl;
  if (!link) return null;
  const linked = await resolveArticle(link, { ...options, enrich: false, onEvent: undefined });
  const best = linked.imageCandidates[0];
  if (!best) return null;
  return loadImage(options.proxyUrl, best.value, {
    fetchImpl: options.fetchImpl,
    signal: options.signal,
    headers: options.headers,
    decode: options.decode,
  });
}
