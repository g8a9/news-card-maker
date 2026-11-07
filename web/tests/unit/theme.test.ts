import { describe, expect, it } from 'vitest';
import {
  blend,
  brandFrameColor,
  buildTheme,
  contrast,
  ensureContrast,
  MIN_CONTRAST,
  readableOn,
  themeVariables,
} from '../../src/brand/theme.ts';
import type { ThemeId } from '../../src/render/style.ts';

/** A small seeded PRNG so the property test is reproducible. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randomHex = (rand: () => number) =>
  `#${Math.floor(rand() * 0xffffff)
    .toString(16)
    .padStart(6, '0')}`;

describe('theme contrast guarantees (PLAN.md §6.6, §13.1)', () => {
  const rand = mulberry32(20261107);
  const colors = [
    '#000000',
    '#FFFFFF',
    '#FFFF00',
    '#FF6600',
    '#052962',
    '#E50B4F',
    '#BB1919',
    '#7F7F7F',
    '#00FFFF',
    ...Array.from({ length: 600 }, () => randomHex(rand)),
  ];

  it.each(['light', 'dark', 'brand', 'paper', 'mono', 'image'] as ThemeId[])(
    '%s: ink on background is at least 4.5 for every brand colour',
    (theme) => {
      for (const brand of colors) {
        const t = buildTheme(theme, { brand });
        expect(contrast(t.ink, t.bg), `${theme} ${brand}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      }
    },
  );

  it.each(['light', 'dark', 'paper'] as ThemeId[])(
    '%s: the accent reaches 4.5 on the background',
    (theme) => {
      for (const brand of colors) {
        const t = buildTheme(theme, { brand });
        expect(contrast(t.accent, t.bg), `${theme} ${brand}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      }
    },
  );

  it('brand: the accent is the ink, and the muted colour reaches 4.5 too', () => {
    for (const brand of colors) {
      const t = buildTheme('brand', { brand });
      expect(t.accent).toBe(t.ink);
      expect(contrast(t.muted, t.bg), brand).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it('light and dark keep their fixed surfaces', () => {
    expect(buildTheme('light')).toMatchObject({
      bg: '#FFFFFF',
      ink: '#111111',
      muted: '#5B5B66',
      rule: '#E6E6EA',
    });
    expect(buildTheme('dark')).toMatchObject({
      bg: '#121214',
      ink: '#F4F4F5',
      muted: '#A1A1AA',
      rule: '#2A2A2E',
    });
  });

  it('keeps a good brand accent untouched and moves a bad one', () => {
    expect(buildTheme('light', { brand: '#052962' }).accent).toBe('#052962');
    const yellow = buildTheme('light', { brand: '#FFD700' }).accent;
    expect(yellow).not.toBe('#FFD700');
    expect(contrast(yellow, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    const navyOnDark = buildTheme('dark', { brand: '#052962' }).accent;
    expect(contrast(navyOnDark, '#121214')).toBeGreaterThanOrEqual(4.5);
  });

  it('paper uses the outlet paper colour', () => {
    expect(buildTheme('paper').bg).toBe('#F6F1E7');
    expect(buildTheme('paper', { paper: '#F5E5D5', brand: '#003C7F' })).toMatchObject({
      bg: '#F5E5D5',
      accent: '#003C7F',
    });
  });

  it('brand: white or near-black ink on the brand colour, whichever reads better', () => {
    expect(buildTheme('brand', { brand: '#052962' })).toMatchObject({
      bg: '#052962',
      ink: '#FFFFFF',
    });
    expect(buildTheme('brand', { brand: '#FF6600' })).toMatchObject({
      bg: '#FF6600',
      ink: '#111111',
    });
  });

  it('falls back sensibly without a brand colour', () => {
    expect(buildTheme('brand').bg).toBe('#1F2937');
    expect(buildTheme('light').accent).toBe('#111111');
  });

  it('exposes CSS variables', () => {
    expect(Object.keys(themeVariables(buildTheme('light')))).toEqual([
      '--bg',
      '--ink',
      '--muted',
      '--rule',
      '--accent',
      '--accent-ink',
      '--scrim',
    ]);
  });
});

describe('colour helpers', () => {
  it('computes WCAG contrast', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1);
    expect(readableOn('#000000')).toBe('#FFFFFF');
    expect(readableOn('#FFFFFF')).toBe('#111111');
  });

  it('ensureContrast keeps hue and lands on the threshold', () => {
    const c = ensureContrast('#FF8888', '#FFFFFF');
    expect(contrast(c, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(c).toMatch(/^#[0-9A-F]{6}$/);
    expect(ensureContrast('#000000', '#FFFFFF')).toBe('#000000');
  });

  it('blends colours', () => {
    expect(blend('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(blend('#FF0000', '#0000FF', 1)).toBe('#FF0000');
  });

  it('derives the frame brand colour: darker, hue rotated', () => {
    const c = brandFrameColor('#2A6FDB');
    expect(c).toMatch(/^#[0-9A-F]{6}$/);
    expect(c).not.toBe('#2A6FDB');
    expect(contrast(c, '#FFFFFF')).toBeGreaterThan(contrast('#2A6FDB', '#FFFFFF'));
  });
});
