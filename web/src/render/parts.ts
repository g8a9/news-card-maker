// The building blocks every template arranges (PLAN.md §7.2): masthead, kicker, headline, deck,
// meta line and image. Extracted strings go in as text nodes only.
import { monogramLetter } from '../brand/logo.ts';
import type { ArticleModel } from '../core/types.ts';
import { effective } from '../core/types.ts';
import type { CardContent } from './content.ts';
import { h, isSafeUrl } from './h.ts';
import type { CardStyle } from './style.ts';

/** Pre-computed assets (baked image, recoloured logo, frame backdrop): the renderer itself is sync. */
export interface RenderAssets {
  imageSrc?: string | null;
  logoSrc?: string | null;
  /** The logo has its own opaque background (app-icon style): round its corners. */
  logoOpaque?: boolean;
  frameBlurSrc?: string | null;
}

export interface Parts {
  masthead: HTMLElement | null;
  kicker: HTMLElement | null;
  headline: HTMLElement;
  deck: HTMLElement | null;
  meta: HTMLElement | null;
  media: HTMLElement | null;
}

export function buildParts(
  article: ArticleModel,
  style: CardStyle,
  content: CardContent,
  assets: RenderAssets,
): Parts {
  return {
    masthead: masthead(article, style, content, assets),
    kicker: content.kicker ? h('p', { class: 'nc-kicker' }, content.kicker) : null,
    headline: h('h1', { class: 'nc-headline' }, content.title),
    deck: content.description ? h('p', { class: 'nc-deck' }, content.description) : null,
    meta: meta(content),
    media: media(article, style, assets),
  };
}

function masthead(
  article: ArticleModel,
  style: CardStyle,
  content: CardContent,
  assets: RenderAssets,
): HTMLElement | null {
  const logo = effective(article.fields.logo);
  const candidate = assets.logoSrc ?? logo?.objectUrl ?? null;
  const src = candidate && isSafeUrl(candidate) ? candidate : null;
  const wantLogo = style.show.logo;
  const kind = logo?.ref.kind;
  const isWordmark = kind === 'wordmark';
  const name = content.siteName;

  // "auto" hides the name next to a wordmark (it says the same thing) and shows it otherwise.
  const showName =
    style.show.siteName === true ||
    (style.show.siteName === 'auto' && !(wantLogo && src && isWordmark));

  const children: HTMLElement[] = [];
  if (wantLogo && src) {
    children.push(
      h('img', {
        class: `nc-logo ${isWordmark ? 'nc-logo-wordmark' : 'nc-logo-icon'}${assets.logoOpaque ? ' nc-logo-rounded' : ''}`,
        src,
        alt: '',
        decoding: 'sync',
      }),
    );
  } else if (wantLogo && name && showName) {
    children.push(h('span', { class: 'nc-monogram', 'aria-hidden': 'true' }, monogramLetter(name)));
  }
  if (showName && name) children.push(h('span', { class: 'nc-site' }, name));
  if (children.length === 0) return null;
  return h('div', { class: 'nc-masthead' }, ...children);
}

function meta(content: CardContent): HTMLElement | null {
  const first = [content.date, content.extra, content.updated, content.accessed].filter(
    (x): x is string => !!x,
  );
  if (first.length === 0 && !content.authors && !content.url) return null;

  const start = h('span', { class: 'nc-meta-start' });
  const pieces: Array<string | HTMLElement> = [...first];
  if (content.authors) pieces.push(h('span', { class: 'nc-authors' }, content.authors));
  pieces.forEach((piece, i) => {
    if (i > 0) start.append(document.createTextNode(' · '));
    start.append(typeof piece === 'string' ? document.createTextNode(piece) : piece);
  });

  return h(
    'footer',
    { class: 'nc-meta' },
    pieces.length > 0 ? start : null,
    content.url ? h('span', { class: 'nc-meta-url' }, content.url) : null,
  );
}

function media(article: ArticleModel, style: CardStyle, assets: RenderAssets): HTMLElement | null {
  const image = effective(article.fields.image);
  const candidate = assets.imageSrc ?? image?.objectUrl ?? null;
  const src = candidate && isSafeUrl(candidate) ? candidate : null;
  if (!style.show.image || !src) return null;
  return h(
    'div',
    { class: 'nc-media' },
    h('img', {
      src,
      alt: '',
      decoding: 'sync',
      draggable: 'false', // a native image drag would swallow the pointer events of the focal-point drag
      style: {
        '--fx': `${style.imageFocus.x * 100}%`,
        '--fy': `${style.imageFocus.y * 100}%`,
        '--zoom': style.imageZoom,
      },
    }),
  );
}
