// Card themes (PLAN.md §6.6): colour tokens with WCAG contrast guarantees, built in OKLCH.
import {
  clampChroma,
  converter,
  formatHex,
  modeLrgb,
  modeOklch,
  modeRgb,
  useMode,
  wcagContrast,
} from 'culori/fn';
import { normalizeColor } from '../core/color.ts';
import type { ThemeId } from '../render/style.ts';

useMode(modeRgb);
useMode(modeOklch);
useMode(modeLrgb); // wcagContrast converts through linear RGB
const toOklch = converter('oklch');
const toRgb = converter('rgb');

export interface ThemeTokens {
  bg: string;
  ink: string;
  muted: string;
  rule: string;
  accent: string;
  /** Readable text on top of `accent`. */
  accentInk: string;
  scrim: string;
}

export const MIN_CONTRAST = 4.5;

export const contrast = (a: string, b: string): number => wcagContrast(a, b);

const BLACK = '#111111';
const WHITE = '#FFFFFF';

/** Whichever of near-black and white reads better on `bg`. */
export function readableOn(bg: string): string {
  return contrast(WHITE, bg) >= contrast(BLACK, bg) ? WHITE : BLACK;
}

const inGamutHex = (l: number, c: number, h: number | undefined): string =>
  formatHex(clampChroma({ mode: 'oklch', l, c, h }, 'oklch'));

/**
 * Moves `fg` lighter or darker in OKLCH (keeping its hue and as much chroma as fits) until it
 * reaches `min` contrast on `bg`. Falls back to black or white when no lightness works.
 */
export function ensureContrast(
  fg: string,
  bg: string,
  min: number = MIN_CONTRAST,
  direction: 'darker' | 'lighter' | 'auto' = 'auto',
): string {
  const start = normalizeColor(fg) ?? '#111111';
  if (contrast(start, bg) >= min) return start;
  const c = toOklch(start);
  if (!c) return readableOn(bg);
  const bgLightness = toOklch(bg)?.l ?? 0.5;
  const dir = direction === 'auto' ? (bgLightness > 0.6 ? 'darker' : 'lighter') : direction;
  const step = dir === 'darker' ? -0.01 : 0.01;
  for (let l = c.l + step; l >= 0 && l <= 1; l += step) {
    const candidate = inGamutHex(l, c.c, c.h).toUpperCase();
    if (contrast(candidate, bg) >= min) return candidate;
  }
  return contrast('#000000', bg) >= contrast('#FFFFFF', bg) ? '#000000' : '#FFFFFF';
}

/** `top` over `bottom` at `alpha`, as an opaque hex colour. */
export function blend(top: string, bottom: string, alpha: number): string {
  const a = toRgb(top);
  const b = toRgb(bottom);
  if (!a || !b) return top;
  const mix = (x: number, y: number) => x * alpha + y * (1 - alpha);
  return formatHex({
    mode: 'rgb',
    r: mix(a.r, b.r),
    g: mix(a.g, b.g),
    b: mix(a.b, b.b),
  }).toUpperCase();
}

/** A background for the Brand theme whose text can reach the minimum contrast. */
function brandBackground(brand: string): { bg: string; ink: string } {
  let bg = normalizeColor(brand) ?? '#1F2937';
  const ink = readableOn(bg);
  if (contrast(ink, bg) >= MIN_CONTRAST) return { bg, ink };
  const c = toOklch(bg);
  if (!c) return { bg: '#1F2937', ink: WHITE };
  // Neither white nor near-black reads: darken (for white text) or lighten the background a little.
  const step = ink === WHITE ? -0.01 : 0.01;
  for (let l = c.l + step; l >= 0 && l <= 1; l += step) {
    const candidate = inGamutHex(l, c.c, c.h).toUpperCase();
    if (contrast(ink, candidate) >= MIN_CONTRAST) {
      bg = candidate;
      return { bg, ink };
    }
  }
  return { bg: '#1F2937', ink: WHITE };
}

export interface ThemeInput {
  /** Brand or user-chosen accent colour. */
  brand?: string | null;
  /** The outlet's paper colour for the Paper theme. */
  paper?: string | null;
}

const SCRIM = 'rgba(0, 0, 0, 0.82)';

export function buildTheme(id: ThemeId, input: ThemeInput = {}): ThemeTokens {
  const brand = input.brand ? normalizeColor(input.brand) : null;

  if (id === 'dark' || id === 'image') {
    const bg = '#121214';
    const ink = '#F4F4F5';
    const accent = brand ? ensureContrast(brand, bg, MIN_CONTRAST, 'lighter') : ink;
    return {
      bg,
      ink,
      muted: '#A1A1AA',
      rule: '#2A2A2E',
      accent,
      accentInk: readableOn(accent),
      scrim: SCRIM,
    };
  }

  if (id === 'brand') {
    const { bg, ink } = brandBackground(brand ?? '#1F2937');
    // "Ink at 72%" is the starting point; on a mid-tone brand colour it can fall below 4.5, so firm it up.
    let alpha = 0.72;
    let muted = blend(ink, bg, alpha);
    while (contrast(muted, bg) < MIN_CONTRAST && alpha < 1) {
      alpha = Math.min(1, alpha + 0.04);
      muted = blend(ink, bg, alpha);
    }
    return {
      bg,
      ink,
      muted,
      rule: blend(ink, bg, 0.28),
      accent: ink,
      accentInk: bg,
      scrim: SCRIM,
    };
  }

  if (id === 'paper') {
    const bg = (input.paper ? normalizeColor(input.paper) : null) ?? '#F6F1E7';
    const preferred = '#1B1B1B';
    const ink = contrast(preferred, bg) >= MIN_CONTRAST ? preferred : readableOn(bg);
    const accent = brand ? ensureContrast(brand, bg, MIN_CONTRAST, 'auto') : ink;
    return {
      bg,
      ink,
      muted: ensureContrast(blend(ink, bg, 0.68), bg, MIN_CONTRAST, 'auto'),
      rule: blend(ink, bg, 0.16),
      accent,
      accentInk: readableOn(accent),
      scrim: SCRIM,
    };
  }

  if (id === 'mono') {
    return {
      bg: '#FFFFFF',
      ink: '#000000',
      muted: '#4D4D4D',
      rule: '#CFCFCF',
      accent: '#000000',
      accentInk: '#FFFFFF',
      scrim: SCRIM,
    };
  }

  // light (default)
  const bg = '#FFFFFF';
  const ink = '#111111';
  const accent = brand ? ensureContrast(brand, bg, MIN_CONTRAST, 'darker') : ink;
  return {
    bg,
    ink,
    muted: '#5B5B66',
    rule: '#E6E6EA',
    accent,
    accentInk: readableOn(accent),
    scrim: SCRIM,
  };
}

/** CSS custom properties for a theme, as set on the card root. */
export function themeVariables(t: ThemeTokens): Record<string, string> {
  return {
    '--bg': t.bg,
    '--ink': t.ink,
    '--muted': t.muted,
    '--rule': t.rule,
    '--accent': t.accent,
    '--accent-ink': t.accentInk,
    '--scrim': t.scrim,
  };
}

/** The Frame's "Brand" background: the brand colour, 25% darker, hue rotated +15°. */
export function brandFrameColor(brand: string): string {
  const c = toOklch(normalizeColor(brand) ?? '#1F2937');
  if (!c) return '#1F2937';
  return inGamutHex(Math.max(0, c.l * 0.75), c.c, ((c.h ?? 0) + 15) % 360).toUpperCase();
}
