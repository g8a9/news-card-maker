import type { Parts } from '../parts.ts';
import type { ResolvedSize } from '../style.ts';

export interface HeadlineBounds {
  /** Headline size in auto-height mode, in u, before the user's scale. */
  autoU: number;
  /** Bounds the fitter searches in fixed-size mode. */
  minU: number;
  maxU: number;
}

export interface TemplateContext {
  card: HTMLElement;
  parts: Parts;
  size: ResolvedSize;
  orientation: 'landscape' | 'square' | 'portrait';
  hasImage: boolean;
}

export interface Template {
  id: 'classic' | 'split' | 'headline';
  headline: HeadlineBounds;
  /** Arranges the parts into the (empty) card element. */
  build(ctx: TemplateContext): void;
}
