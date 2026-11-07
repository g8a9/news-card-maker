// Starting styles (PLAN.md §7.2: "the registry can set per-outlet defaults").
import outletData from '../brand/outlets.json';
import type { Outlet } from '../core/registry.ts';
import {
  type CardStyle,
  defaultStyle,
  type FontId,
  type TemplateId,
  type ThemeId,
} from '../render/style.ts';

export const OUTLETS: Outlet[] = outletData as Outlet[];

const THEMES: ThemeId[] = ['light', 'dark', 'brand', 'paper', 'image', 'mono'];
const TEMPLATES: TemplateId[] = ['classic', 'split', 'headline', 'hero', 'browser', 'strip'];
const FONT_IDS: FontId[] = [
  'newsreader',
  'source-serif',
  'inter',
  'inter-tight',
  'jetbrains-mono',
  'system',
];

const pick = <T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined =>
  allowed.find((a) => a === value);

/**
 * The style for a freshly loaded card: the user's current choices, plus the outlet's defaults when the
 * user has not changed them away from the factory style (a user who picked "Dark" keeps it across outlets).
 */
export function styleForNewCard(current: CardStyle, outlet?: Outlet | null): CardStyle {
  const factory = defaultStyle();
  const next: CardStyle = { ...current, show: { ...current.show } };
  const d = outlet?.defaults;
  if (d) {
    const theme = pick(d.theme, THEMES);
    const template = pick(d.template, TEMPLATES);
    const font = pick(d.headlineFont, FONT_IDS);
    if (theme && current.theme === factory.theme) next.theme = theme;
    if (template && current.template === factory.template) next.template = template;
    if (font && current.fonts.headline === factory.fonts.headline) {
      next.fonts = { ...current.fonts, headline: font };
    }
  }
  return next;
}
