import { describe, expect, it } from 'vitest';
import { initialState } from '../../src/state/app-state.ts';
import { sourceLabel } from '../../src/ui/controls/labels.ts';
import { SECTIONS } from '../../src/ui/controls/schema.ts';
import { makeModel } from './card-helpers.ts';

describe('settings schema (PLAN.md §9.4)', () => {
  const controls = SECTIONS.flatMap((s) => s.controls);

  it('has the five documented sections in order', () => {
    expect(SECTIONS.map((s) => s.title)).toEqual(['Content', 'Layout', 'Style', 'Frame', 'Export']);
  });

  it('gives every control a unique id and a label', () => {
    const ids = controls.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of controls) expect(c.label.length, c.id).toBeGreaterThan(0);
  });

  it('points every control at a real state path', () => {
    const state = { ...initialState(), article: makeModel() } as unknown as Record<string, unknown>;
    const resolve = (path: string) =>
      path
        .split('.')
        .reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], state);
    for (const c of controls) {
      if ('path' in c)
        expect(
          resolve(c.path) !== undefined || c.path.startsWith('style.frame.background'),
          `${c.id}: ${c.path}`,
        ).toBe(true);
      if ('show' in c && c.show)
        expect(resolve(c.show), `${c.id} show ${c.show}`).toBeTypeOf('boolean');
    }
  });

  it('offers only real options for choice controls', () => {
    for (const c of controls) {
      if (c.type === 'select' || c.type === 'segmented') {
        expect(c.options.length, c.id).toBeGreaterThan(1);
        const values = c.options.map((o) => String(o.value));
        expect(new Set(values).size, c.id).toBe(values.length);
      }
      if (c.type === 'slider') expect(c.min, c.id).toBeLessThan(c.max);
    }
  });

  it('hides controls that do not apply (visibleIf)', () => {
    const state = { ...initialState(), article: makeModel() };
    const by = (id: string) => controls.find((c) => c.id === id);
    expect(by('width')?.visibleIf?.(state)).toBe(true); // Auto size
    const fixed = {
      ...state,
      style: { ...state.style, size: { preset: '16:9' as const, width: 1200, height: null } },
    };
    expect(by('width')?.visibleIf?.(fixed)).toBe(false);
    expect(by('imagePosition')?.visibleIf?.(state)).toBe(false); // Classic
    expect(
      by('imagePosition')?.visibleIf?.({ ...state, style: { ...state.style, template: 'split' } }),
    ).toBe(true);
    expect(
      by('image')?.visibleIf?.({ ...state, style: { ...state.style, template: 'headline' } }),
    ).toBe(false);
    expect(by('quality')?.visibleIf?.(state)).toBe(false); // PNG
    expect(
      by('quality')?.visibleIf?.({
        ...state,
        style: { ...state.style, export: { ...state.style.export, format: 'jpeg' } },
      }),
    ).toBe(true);
    expect(by('framePadding')?.visibleIf?.(state)).toBe(false); // frame off
  });
});

describe('alternatives labels', () => {
  it('names each source the way the plan does', () => {
    expect(sourceLabel('jsonld', undefined, 'title')).toBe('Structured data');
    expect(sourceLabel('og', undefined, 'title')).toBe('Social title');
    expect(sourceLabel('og', undefined, 'description')).toBe('Social description');
    expect(sourceLabel('html', 'h1', 'title')).toBe('Page headline');
    expect(sourceLabel('html', 'title', 'title')).toBe('SEO title');
    expect(sourceLabel('feed', undefined, 'title')).toBe('RSS');
    expect(sourceLabel('html', 'h1, title', 'title')).toBe('Page headline');
  });
});
