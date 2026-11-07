// renderCard(): builds the card DOM from an ArticleModel and a CardStyle (PLAN.md §7.1). Synchronous
// and side-effect free: heavy work (baked images, recoloured logos) arrives pre-computed in `assets`.
import { brandFrameColor, buildTheme, themeVariables } from '../brand/theme.ts';
import { normalizeColor } from '../core/color.ts';
import type { Outlet } from '../core/registry.ts';
import type { ArticleModel } from '../core/types.ts';
import { altText, cardContent } from './content.ts';
import { FONTS, headlineWeight, resolveHeadlineFont } from './fonts.ts';
import { h, isSafeUrl } from './h.ts';
import { buildParts, type RenderAssets } from './parts.ts';
import {
  type CardStyle,
  type FontId,
  orientationOf,
  type ResolvedSize,
  resolveSize,
} from './style.ts';
import { classic } from './templates/classic.ts';
import { headline } from './templates/headline.ts';
import { split } from './templates/split.ts';
import type { Template } from './templates/types.ts';

import './fonts.css';
import './card.css';

const TEMPLATES: Record<string, Template> = { classic, split, headline };

export interface RenderInput {
  article: ArticleModel;
  style: CardStyle;
  outlet?: Outlet | null;
  assets?: RenderAssets;
  hostLocale?: string;
  now?: Date;
}

export interface RenderedCard {
  /** The element to put on the stage and to export: the frame when enabled, else the card. */
  root: HTMLElement;
  card: HTMLElement;
  alt: string;
  size: ResolvedSize;
  /** Logical width of `root` (card plus frame padding). */
  width: number;
  fonts: FontId[];
  /** All text on the card, used to load the right font subsets. */
  text: string;
}

export const GRADIENTS: Record<string, { label: string; css: string }> = {
  graphite: { label: 'Graphite', css: 'linear-gradient(135deg, #3a3d44 0%, #15171b 100%)' },
  ink: { label: 'Ink', css: 'linear-gradient(135deg, #1b2440 0%, #070a14 100%)' },
  dusk: { label: 'Dusk', css: 'linear-gradient(135deg, #5b3a8c 0%, #1d1b3a 100%)' },
  paper: { label: 'Paper', css: 'linear-gradient(135deg, #f6f1e7 0%, #e4dccb 100%)' },
  sunset: { label: 'Sunset', css: 'linear-gradient(135deg, #ff8a5c 0%, #c2306b 100%)' },
  aurora: { label: 'Aurora', css: 'linear-gradient(135deg, #3ddc97 0%, #2a6fdb 100%)' },
  ocean: { label: 'Ocean', css: 'linear-gradient(135deg, #38bdf8 0%, #1e3a8a 100%)' },
  mist: { label: 'Mist', css: 'linear-gradient(135deg, #f1f5f9 0%, #cbd5e1 100%)' },
};

const SHADOWS: Record<CardStyle['frame']['shadow'], string> = {
  none: '0 0 0 0 transparent',
  soft: '0 calc(var(--u) * 1.2) calc(var(--u) * 3.6) rgba(0, 0, 0, 0.18)',
  medium: '0 calc(var(--u) * 1.6) calc(var(--u) * 5) rgba(0, 0, 0, 0.28)',
  strong: '0 calc(var(--u) * 2.4) calc(var(--u) * 7) rgba(0, 0, 0, 0.42)',
};

interface FrameBackground {
  color?: string;
  image?: string;
}

function frameBackground(
  style: CardStyle,
  article: ArticleModel,
  assets: RenderAssets,
): FrameBackground {
  const bg = style.frame.background;
  const graphite = { image: GRADIENTS.graphite?.css };
  switch (bg.kind) {
    case 'transparent':
      return { color: 'transparent' };
    case 'solid':
      return { color: normalizeColor(bg.value) ?? '#E8E8EC' };
    case 'gradient':
      return { image: (GRADIENTS[bg.value ?? ''] ?? GRADIENTS.graphite)?.css };
    case 'brand':
      return { color: brandFrameColor(style.accent ?? article.brand.color ?? '#1F2937') };
    case 'blur':
      return assets.frameBlurSrc && isSafeUrl(assets.frameBlurSrc)
        ? { image: `url("${assets.frameBlurSrc}")` }
        : graphite;
  }
}

export function renderCard(input: RenderInput): RenderedCard {
  const { article, style, outlet } = input;
  const assets = input.assets ?? {};
  const size = resolveSize(style.size);
  const orientation = orientationOf(size);
  const unit = size.width / 100;
  const fixed = size.height !== null;

  const content = cardContent(article, style, {
    hostLocale:
      input.hostLocale ?? (typeof navigator === 'undefined' ? 'en' : navigator.language) ?? 'en',
    now: input.now ?? new Date(),
    width: size.width,
  });
  const parts = buildParts(article, style, content, assets);
  const hasImage = !!parts.media;

  // Split needs width: portrait sizes use the Classic structure. Unknown templates (extras) too.
  let template = TEMPLATES[style.template] ?? classic;
  if (template.id === 'split' && orientation === 'portrait') template = classic;

  const tokens = buildTheme(style.theme, {
    brand: style.accent ?? article.brand.color ?? null,
    paper: article.brand.paper ?? null,
  });
  const headlineFont = resolveHeadlineFont(style, style.theme, outlet);
  const bodyFont = style.fonts.body;
  // Tall and square cards have more room for the headline than wide-and-short ones.
  const roomy = fixed
    ? orientation === 'portrait'
      ? 1.3
      : orientation === 'square'
        ? 1.12
        : 1
    : 1;
  const scale = Math.min(1.25, Math.max(0.8, style.headlineScale));
  const startU = (fixed ? template.headline.maxU * roomy : template.headline.autoU) * scale;

  const card = h('article', {
    class: [
      'nc-card',
      `nc-t-${template.id}`,
      `nc-theme-${style.theme}`,
      `nc-align-${style.align}`,
      `nc-density-${style.density}`,
      style.border === 'hairline' ? 'nc-border-hairline' : '',
      fixed ? 'nc-fixed' : 'nc-auto',
      style.imagePosition === 'start' ? 'nc-img-start' : 'nc-img-end',
    ]
      .filter(Boolean)
      .join(' '),
    lang: article.lang,
    dir: article.dir,
    style: {
      ...themeVariables(tokens),
      '--w': `${size.width}px`,
      '--h': fixed ? `${size.height}px` : null,
      '--u': `${unit}px`,
      '--hu': startU,
      '--head-weight': headlineWeight(headlineFont),
      '--font-head': FONTS[headlineFont].stack,
      '--font-body': FONTS[bodyFont].stack,
      '--font-mono': FONTS['jetbrains-mono'].stack,
      '--radius': style.radius,
    },
    dataset: {
      template: template.id,
      requested: style.template,
      minU: template.headline.minU * scale,
      maxU: template.headline.maxU * scale * roomy,
      autoU: template.headline.autoU * scale,
    },
  });
  template.build({ card, parts, size, orientation, hasImage });

  let root: HTMLElement = card;
  let width = size.width;
  if (style.frame.enabled) {
    const pad = Math.min(20, Math.max(0, style.frame.padding));
    width = size.width + 2 * pad * unit;
    const backdrop = frameBackground(style, article, assets);
    root = h(
      'div',
      {
        class: 'nc-frame',
        style: {
          '--w': `${size.width}px`,
          '--u': `${unit}px`,
          '--frame-pad': pad,
          '--shadow': SHADOWS[style.frame.shadow],
          'background-color': backdrop.color,
          'background-image': backdrop.image,
          'background-size': 'cover',
          'background-position': 'center',
        },
      },
      card,
    );
  }

  const text = [
    content.title,
    content.description,
    content.kicker,
    content.siteName,
    content.date,
    content.authors,
    content.url,
  ]
    .filter(Boolean)
    .join(' ');
  return {
    root,
    card,
    alt: altText(content),
    size,
    width,
    fonts: [headlineFont, bodyFont, 'jetbrains-mono'],
    text,
  };
}
