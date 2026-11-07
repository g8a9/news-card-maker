import { describe, expect, it } from 'vitest';
import { defaultStyle, orientationOf, resolveSize, SIZE_PRESETS } from '../../src/render/style.ts';

describe('sizes (PLAN.md §7.3)', () => {
  it.each([
    ['16:9', 1200, 675],
    ['4:3', 1200, 900],
    ['3:2', 1200, 800],
    ['1.91:1', 1200, 628],
    ['2:1', 1200, 600],
    ['1:1', 1080, 1080],
    ['4:5', 1080, 1350],
    ['9:16', 1080, 1920],
  ] as const)('%s is %i×%i', (preset, w, h) => {
    expect(resolveSize({ preset, width: 999, height: 999 })).toEqual({ width: w, height: h });
    expect(SIZE_PRESETS[preset]).toEqual([w, h]);
  });

  it('auto keeps the width (600–2000) and leaves the height to the content', () => {
    expect(resolveSize({ preset: 'auto', width: 1200, height: null })).toEqual({
      width: 1200,
      height: null,
    });
    expect(resolveSize({ preset: 'auto', width: 100, height: null }).width).toBe(600);
    expect(resolveSize({ preset: 'auto', width: 9000, height: null }).width).toBe(2000);
  });

  it('custom clamps both sides to 320–4000', () => {
    expect(resolveSize({ preset: 'custom', width: 1000, height: 500 })).toEqual({
      width: 1000,
      height: 500,
    });
    expect(resolveSize({ preset: 'custom', width: 10, height: 99999 })).toEqual({
      width: 320,
      height: 4000,
    });
    expect(resolveSize({ preset: 'custom', width: 800, height: null })).toEqual({
      width: 800,
      height: 800,
    });
  });

  it('classifies orientation', () => {
    expect(orientationOf({ width: 1200, height: null })).toBe('landscape');
    expect(orientationOf({ width: 1200, height: 675 })).toBe('landscape');
    expect(orientationOf({ width: 1200, height: 900 })).toBe('landscape');
    expect(orientationOf({ width: 1080, height: 1080 })).toBe('square');
    expect(orientationOf({ width: 1080, height: 1350 })).toBe('square');
    expect(orientationOf({ width: 1080, height: 1920 })).toBe('portrait');
  });

  it('has the documented defaults (§10)', () => {
    const s = defaultStyle();
    expect(s).toMatchObject({
      v: 1,
      template: 'classic',
      theme: 'light',
      size: { preset: 'auto', width: 1200, height: null },
      export: { format: 'png', scale: 2 },
      frame: { enabled: false },
      radius: 1.6,
    });
    expect(s.show).toMatchObject({
      image: true,
      kicker: false,
      authors: false,
      date: true,
      url: true,
      accessed: false,
    });
  });
});
