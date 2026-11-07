import { describe, expect, it } from 'vitest';
import { chooseTreatment, monogramLetter } from '../../src/brand/logo.ts';
import {
  FONTS,
  headlineWeight,
  loadCardFonts,
  resolveHeadlineFont,
} from '../../src/render/fonts.ts';
import { defaultStyle } from '../../src/render/style.ts';

describe('chooseTreatment (PLAN.md §6.4)', () => {
  const plain = { opaqueCorners: false, fgLuminance: 0.1 };
  const appIcon = { opaqueCorners: true, fgLuminance: 0.5 };
  const white = { opaqueCorners: false, fgLuminance: 0.95 };

  it('respects an explicit choice', () => {
    expect(chooseTreatment({ choice: 'original', theme: 'dark', stats: plain })).toBe('original');
    expect(chooseTreatment({ choice: 'mono', theme: 'light', stats: appIcon })).toBe('mono');
  });

  it('auto: mono on dark, brand and mono themes unless the logo has its own background', () => {
    for (const theme of ['dark', 'brand', 'image'] as const) {
      expect(chooseTreatment({ choice: 'auto', theme, stats: plain })).toBe('mono');
      expect(chooseTreatment({ choice: 'auto', theme, stats: appIcon })).toBe('original');
      expect(chooseTreatment({ choice: 'auto', theme, stats: null })).toBe('mono');
    }
    expect(chooseTreatment({ choice: 'auto', theme: 'mono', stats: appIcon })).toBe('mono');
  });

  it('auto: original on light and paper, but a white logo goes mono dark', () => {
    for (const theme of ['light', 'paper'] as const) {
      expect(chooseTreatment({ choice: 'auto', theme, stats: plain })).toBe('original');
      expect(chooseTreatment({ choice: 'auto', theme, stats: appIcon })).toBe('original');
      expect(chooseTreatment({ choice: 'auto', theme, stats: white })).toBe('mono');
      expect(chooseTreatment({ choice: 'auto', theme, stats: null })).toBe('original');
    }
  });

  it('registry hints win over auto, but not over an explicit choice', () => {
    expect(chooseTreatment({ choice: 'auto', theme: 'dark', stats: plain, hint: 'original' })).toBe(
      'original',
    );
    expect(chooseTreatment({ choice: 'auto', theme: 'light', stats: plain, hint: 'mono' })).toBe(
      'mono',
    );
    expect(
      chooseTreatment({ choice: 'original', theme: 'light', stats: plain, hint: 'mono' }),
    ).toBe('original');
  });
});

describe('monogramLetter', () => {
  it.each([
    ['The Courier', 'C'],
    ['la Repubblica', 'R'],
    ['Der Spiegel', 'S'],
    ['404 Media', '4'],
    ['élan', 'É'],
    ['日本経済新聞', '日'],
    ['—', '•'],
  ])('%s → %s', (name, letter) => {
    expect(monogramLetter(name)).toBe(letter);
  });
});

describe('fonts', () => {
  it('weights: 600 for serif, 650 for sans', () => {
    expect(headlineWeight('newsreader')).toBe(600);
    expect(headlineWeight('source-serif')).toBe(600);
    expect(headlineWeight('inter-tight')).toBe(650);
    expect(headlineWeight('system')).toBe(650);
  });

  it('auto headline font: user choice, then the outlet hint, then Newsreader', () => {
    const style = defaultStyle();
    expect(resolveHeadlineFont(style, 'light')).toBe('newsreader');
    expect(resolveHeadlineFont(style, 'paper')).toBe('newsreader');
    expect(
      resolveHeadlineFont(style, 'light', {
        id: 'x',
        name: 'X',
        domains: [],
        fonts: { headline: 'sans' },
      }),
    ).toBe('inter-tight');
    expect(
      resolveHeadlineFont(style, 'light', {
        id: 'x',
        name: 'X',
        domains: [],
        fonts: { headline: 'serif' },
      }),
    ).toBe('newsreader');
    expect(
      resolveHeadlineFont({ ...style, fonts: { ...style.fonts, headline: 'inter' } }, 'light', {
        id: 'x',
        name: 'X',
        domains: [],
        fonts: { headline: 'serif' },
      }),
    ).toBe('inter');
  });

  it('every stack ends in a generic family and covers emoji', () => {
    for (const def of Object.values(FONTS)) {
      expect(def.stack, def.id).toMatch(/(sans-serif|serif|monospace)$/);
      expect(def.stack, def.id).toContain('Noto Color Emoji');
    }
    expect(FONTS.system.face).toBeNull();
    expect(FONTS.newsreader.face).toBe('Newsreader Variable');
  });

  it('loads nothing (and does not fail) where the Font Loading API is missing', async () => {
    await expect(loadCardFonts(['newsreader', 'inter'], 'text')).resolves.toBeUndefined();
  });
});
