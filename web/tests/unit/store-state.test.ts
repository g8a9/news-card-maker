import { describe, expect, it, vi } from 'vitest';
import { initialState } from '../../src/state/app-state.ts';
import { clearOverride, hasOverride, setOverride, withField } from '../../src/state/fields.ts';
import { getPath, setPath } from '../../src/state/paths.ts';
import { createStore, shallowEqual } from '../../src/state/store.ts';
import { makeModel } from './card-helpers.ts';

describe('store (PLAN.md §10)', () => {
  it('applies updates at once and notifies once per batch', () => {
    const store = createStore({ n: 0, other: 'x' });
    const seen: number[] = [];
    store.subscribe(
      (s) => s.n,
      (v) => seen.push(v),
    );
    store.set({ n: 1 });
    store.set((s) => ({ ...s, n: 2 }));
    store.set({ n: 3 });
    expect(store.get().n).toBe(3); // synchronous
    expect(seen).toEqual([]); // notified later, in a batch
    store.flush();
    expect(seen).toEqual([3]);
  });

  it('only notifies subscribers whose selected value changed', () => {
    const store = createStore({ a: 1, b: 1 });
    const a = vi.fn();
    const b = vi.fn();
    store.subscribe((s) => s.a, a);
    store.subscribe((s) => s.b, b);
    store.set({ a: 2 });
    store.flush();
    expect(a).toHaveBeenCalledWith(2, 1);
    expect(b).not.toHaveBeenCalled();
  });

  it('supports tuple selectors with shallowEqual, immediate calls and unsubscribe', () => {
    const store = createStore({ x: 1, y: 1, z: 1 });
    const cb = vi.fn();
    const off = store.subscribe((s) => [s.x, s.y], cb, { equals: shallowEqual, immediate: true });
    expect(cb).toHaveBeenCalledTimes(1);
    store.set({ z: 2 });
    store.flush();
    expect(cb).toHaveBeenCalledTimes(1); // x and y are unchanged
    store.set({ x: 2 });
    store.flush();
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    store.set({ x: 3 });
    store.flush();
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('ignores updates that return the same state', () => {
    const store = createStore({ n: 1 });
    const cb = vi.fn();
    store.subscribe((s) => s, cb);
    store.set((s) => s);
    store.flush();
    expect(cb).not.toHaveBeenCalled();
  });

  it('flushes on its own: a frame or the timer fallback', async () => {
    const store = createStore({ n: 0 });
    const seen: number[] = [];
    store.subscribe(
      (s) => s.n,
      (v) => seen.push(v),
    );
    store.set({ n: 5 });
    await new Promise((r) => setTimeout(r, 120));
    expect(seen).toEqual([5]);
  });

  it('shallowEqual compares arrays element-wise', () => {
    expect(shallowEqual([1, 'a'], [1, 'a'])).toBe(true);
    expect(shallowEqual([1], [2])).toBe(false);
    expect(shallowEqual([1], [1, 2])).toBe(false);
    expect(shallowEqual({}, {})).toBe(false);
  });
});

describe('paths', () => {
  const state = { style: { show: { kicker: false }, size: { width: 1200 } }, other: 1 };

  it('reads nested values and tolerates missing ones', () => {
    expect(getPath(state, 'style.show.kicker')).toBe(false);
    expect(getPath(state, 'style.nope.deeper')).toBeUndefined();
    expect(getPath(null, 'a')).toBeUndefined();
  });

  it('writes immutably, sharing everything off the path', () => {
    const next = setPath(state, 'style.show.kicker', true);
    expect(next.style.show.kicker).toBe(true);
    expect(state.style.show.kicker).toBe(false);
    expect(next.style.size).toBe(state.style.size);
    expect(next.other).toBe(1);
  });

  it('creates missing branches', () => {
    expect(setPath({} as Record<string, unknown>, 'a.b.c', 1)).toEqual({ a: { b: { c: 1 } } });
  });
});

describe('field overrides', () => {
  const base = () => ({ ...initialState(), article: makeModel() });

  it('overrides a field without losing its options, and clears again', () => {
    const edited = setOverride(base(), 'title', 'Mine');
    expect(edited.article?.fields.title.override).toBe('Mine');
    expect(edited.article?.fields.title.value).toBe(
      'Council approves harbour tram line after late vote',
    );
    expect(edited.article?.fields.title.options).toHaveLength(1);
    expect(hasOverride(edited, 'title')).toBe(true);
    const cleared = clearOverride(edited, 'title');
    expect(hasOverride(cleared, 'title')).toBe(false);
    expect('override' in (cleared.article?.fields.title ?? {})).toBe(false);
  });

  it('is a no-op without an article', () => {
    const empty = initialState();
    expect(setOverride(empty, 'title', 'x')).toBe(empty);
    expect(withField(empty, 'title', (f) => f)).toBe(empty);
  });

  it('keeps an explicit null override (a user who cleared the field)', () => {
    const s = setOverride(base(), 'description', null);
    expect(s.article?.fields.description.override).toBeNull();
    expect(hasOverride(s, 'description')).toBe(true);
  });
});
