import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createExportActions } from '../../src/export/actions.ts';
import { renderToBlob } from '../../src/export/capture.ts';
import { downloadBlob } from '../../src/export/download.ts';
import { fileName, slug } from '../../src/export/filename.ts';
import { exportHash } from '../../src/export/hash.ts';
import { clampScale, isIOS, MAX_PIXELS_DEFAULT, MAX_PIXELS_IOS } from '../../src/export/scale.ts';
import { type AppState, initialState } from '../../src/state/app-state.ts';
import { setOverride } from '../../src/state/fields.ts';
import { setPath } from '../../src/state/paths.ts';
import { createStore } from '../../src/state/store.ts';
import { day, makeModel } from './card-helpers.ts';

describe('scale guard (PLAN.md §8.1)', () => {
  it('keeps the requested scale when it fits', () => {
    expect(clampScale(1200, 675, 2)).toEqual({
      scale: 2,
      clamped: false,
      width: 2400,
      height: 1350,
    });
    expect(clampScale(1080, 1920, 4, MAX_PIXELS_DEFAULT)).toMatchObject({
      clamped: false,
      width: 4320,
      height: 7680,
    });
  });

  it('reduces the scale to stay under the pixel limit', () => {
    const r = clampScale(1080, 1920, 4, MAX_PIXELS_IOS); // 4320 × 7680 = 33M px: too big for iOS
    expect(r.clamped).toBe(true);
    expect(r.width * r.height).toBeLessThanOrEqual(MAX_PIXELS_IOS);
    expect(r.scale).toBeLessThan(4);
    expect(r.scale).toBeGreaterThan(1);
    const huge = clampScale(4000, 4000, 4);
    expect(huge.clamped).toBe(true);
    expect(huge.width * huge.height).toBeLessThanOrEqual(MAX_PIXELS_DEFAULT);
  });

  it('never goes below a usable scale', () => {
    expect(clampScale(100_000, 100_000, 2).scale).toBeGreaterThanOrEqual(0.1);
  });

  it('recognises iOS and iPadOS', () => {
    expect(isIOS('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone', 5)).toBe(true);
    expect(isIOS('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', 'iPad', 5)).toBe(true);
    expect(isIOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5)).toBe(true); // iPadOS "desktop" mode
    expect(isIOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0)).toBe(false);
    expect(isIOS('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 0)).toBe(false);
  });
});

describe('file names (PLAN.md §8.3)', () => {
  const base = {
    siteName: 'The Guardian',
    host: 'www.theguardian.com',
    published: day(2026, 11, 6),
    title: 'Kenyan doomsday sect leader jailed for 200 years for murder of 190 children',
  };

  it('follows {outlet}-{date}-{first six words}.{ext}', () => {
    expect(fileName(base, 'png')).toBe(
      'the-guardian-2026-11-06-kenyan-doomsday-sect-leader-jailed-for.png',
    );
    expect(fileName(base, 'jpg')).toMatch(/\.jpg$/);
  });

  it('folds accents and punctuation to ASCII', () => {
    expect(slug('Città, perché l’università è più cara!')).toBe(
      'citta-perche-l-universita-e-piu-cara',
    );
    expect(slug('  Ünïcödé — “quotes” & more  ')).toBe('unicode-quotes-more');
  });

  it('is at most 80 characters, extension included', () => {
    const long = {
      ...base,
      siteName: 'An Extremely Long Outlet Name That Goes On And On',
      title:
        'Antidisestablishmentarianism pneumonoultramicroscopicsilicovolcanoconiosis floccinaucinihilipilification',
    };
    const name = fileName(long, 'webp');
    expect(name.length).toBeLessThanOrEqual(80);
    expect(name.endsWith('.webp')).toBe(true);
    expect(name).not.toMatch(/-\.webp$/);
  });

  it('falls back to the host when the outlet name has no ASCII letters, and skips unknown parts', () => {
    expect(fileName({ ...base, siteName: 'الأخبار', title: 'ارتفاع أسعار النفط' }, 'png')).toBe(
      'theguardian-com-2026-11-06.png',
    );
    expect(
      fileName(
        { siteName: null, host: 'blog.example.test', published: null, title: 'My weekend notes' },
        'png',
      ),
    ).toBe('blog-example-test-my-weekend-notes.png');
    expect(fileName({ siteName: null, host: '', published: null, title: '' }, 'png')).toBe(
      'card.png',
    );
  });
});

describe('export hash', () => {
  const state = () => ({ ...initialState(), article: makeModel(), phase: 'editing' as const });

  it('is stable for equal state and empty without an article', () => {
    expect(exportHash(state())).toBe(exportHash(state()));
    expect(exportHash(initialState())).toBe('');
  });

  it('changes with anything that changes the picture', () => {
    const before = exportHash(state());
    expect(exportHash(setPath(state(), 'style.theme', 'dark'))).not.toBe(before);
    expect(exportHash(setPath(state(), 'style.frame.enabled', true))).not.toBe(before);
    expect(exportHash(setOverride(state(), 'title', 'Another headline'))).not.toBe(before);
    expect(
      exportHash({ ...state(), article: makeModel({ citeUrl: 'https://example.test/other' }) }),
    ).not.toBe(before);
    expect(exportHash({ ...state(), article: makeModel({ image: null }) })).not.toBe(before);
  });

  it('ignores things that do not change the picture', () => {
    const before = exportHash(state());
    const s = state();
    expect(
      exportHash({ ...s, ui: { ...s.ui, openSections: ['style'], activeSection: 'style' } }),
    ).toBe(before);
    expect(exportHash({ ...s, notices: ['hello'] })).toBe(before);
  });
});

// ---- Copy, download and the pre-render cache ---------------------------------------------------------
vi.mock('../../src/export/capture.ts', () => ({ renderToBlob: vi.fn() }));
vi.mock('../../src/export/download.ts', () => ({
  downloadBlob: vi.fn(),
  canShareFile: vi.fn(() => false),
}));

describe('export actions (PLAN.md §8.2)', () => {
  const blob = (type = 'image/png') => new Blob([new Uint8Array([1, 2, 3])], { type });
  let items: Array<Record<string, Promise<Blob>>>;
  let write: ReturnType<typeof vi.fn>;
  let openFallback: ReturnType<typeof vi.fn>;

  // A long idle time keeps other tests' stores from pre-rendering into the shared mock behind their backs.
  function setup(idleMs = 600_000) {
    const store = createStore<AppState>({
      ...initialState(),
      phase: 'editing',
      article: makeModel(),
      ui: { ...initialState().ui, measured: { width: 1200, height: 675 } },
    });
    const node = document.createElement('div');
    const stage = { target: () => node, settled: () => Promise.resolve() };
    const actions = createExportActions({
      store,
      stage,
      openFallback: openFallback as unknown as (b: Blob) => void,
      idleMs,
    });
    return { store, node, actions };
  }

  beforeEach(() => {
    vi.mocked(renderToBlob)
      .mockReset()
      .mockImplementation(async (_n, o) => blob(o.type));
    vi.mocked(downloadBlob).mockReset();
    items = [];
    write = vi.fn(async (list: Array<{ data: Record<string, Promise<Blob>> }>) => {
      items.push(...list.map((i) => i.data));
    });
    openFallback = vi.fn();
    class FakeClipboardItem {
      data: Record<string, Promise<Blob>>;
      constructor(data: Record<string, Promise<Blob>>) {
        this.data = data;
      }
    }
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
  });

  it('creates the Promise-valued ClipboardItem synchronously, inside the gesture', async () => {
    const { actions } = setup();
    const pending = actions.copy();
    // No await has happened yet: the write must already have been issued.
    expect(write).toHaveBeenCalledTimes(1);
    expect(items[0]?.['image/png']).toBeInstanceOf(Promise);
    await pending;
    expect(await items[0]?.['image/png']).toBeInstanceOf(Blob);
  });

  it('reports the size that was copied', async () => {
    const { actions, store } = setup();
    await actions.copy();
    expect(store.get().ui.toasts.map((t) => t.text)).toEqual(['Copied 2400×1350 PNG']);
  });

  it('notes when the scale guard reduced the size', async () => {
    const { actions, store } = setup();
    store.set((s) => ({
      ...setPath(s, 'style.export.scale', 4),
      ui: { ...s.ui, measured: { width: 4000, height: 4000 } },
    }));
    await actions.copy();
    expect(store.get().ui.toasts[0]?.text).toMatch(
      /^Copied \d+×\d+ PNG \(reduced to fit the browser limit\)$/,
    );
    const call = vi.mocked(renderToBlob).mock.calls[0]?.[1];
    expect(call?.scale).toBeLessThan(4);
  });

  it('opens the fallback dialog with the image when the browser refuses', async () => {
    write.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    const { actions } = setup();
    await actions.copy();
    await vi.waitFor(() => expect(openFallback).toHaveBeenCalledTimes(1));
    expect(openFallback.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
  });

  it('survives a clipboard API that throws synchronously', async () => {
    write.mockImplementationOnce(() => {
      throw new TypeError('not allowed');
    });
    const { actions } = setup();
    await actions.copy();
    await vi.waitFor(() => expect(openFallback).toHaveBeenCalled());
  });

  it('does nothing before there is a card', async () => {
    const { actions, store } = setup();
    store.set((s) => ({ ...s, phase: 'loading' }));
    await actions.copy();
    await actions.download();
    expect(write).not.toHaveBeenCalled();
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it('reuses the pre-rendered PNG while the card is unchanged, and renders again after a change', async () => {
    const { actions, store } = setup(5);
    // A new measurement is what the stage publishes after each render: it schedules the idle pre-render.
    store.set((s) => ({ ...s, ui: { ...s.ui, measured: { width: 1200, height: 676 } } }));
    store.flush();
    await new Promise((r) => setTimeout(r, 60));
    expect(renderToBlob).toHaveBeenCalledTimes(1);
    await actions.copy();
    expect(renderToBlob).toHaveBeenCalledTimes(1); // served from the cache

    store.set((s) => setPath(s, 'style.theme', 'dark'));
    await actions.copy(); // the cache is stale: an on-demand render
    expect(renderToBlob).toHaveBeenCalledTimes(2);
  });

  it('downloads with a readable name and the format the engine really produced', async () => {
    const { actions } = setup();
    await actions.download('png');
    expect(downloadBlob).toHaveBeenLastCalledWith(
      expect.any(Blob),
      'the-courier-2026-11-06-council-approves-harbour-tram-line-after.png',
    );
    await actions.download('jpeg');
    expect(downloadBlob).toHaveBeenLastCalledWith(
      expect.any(Blob),
      expect.stringMatching(/\.jpg$/),
    );
    // Safari answers a WebP request with a PNG: the file must not be named .webp
    vi.mocked(renderToBlob).mockResolvedValueOnce(blob('image/png'));
    await actions.download('webp');
    expect(downloadBlob).toHaveBeenLastCalledWith(
      expect.any(Blob),
      expect.stringMatching(/\.png$/),
    );
  });

  it('fills formats without alpha with the card colour and passes the quality', async () => {
    const { actions, node } = setup();
    const card = document.createElement('article');
    card.className = 'nc-card';
    card.style.setProperty('--bg', '#F6F1E7');
    node.append(card);
    await actions.download('jpeg');
    const options = vi.mocked(renderToBlob).mock.calls.at(-1)?.[1];
    expect(options).toMatchObject({ type: 'image/jpeg', quality: 0.92, background: '#F6F1E7' });
    await actions.download('png');
    expect(vi.mocked(renderToBlob).mock.calls.at(-1)?.[1].background).toBeNull();
  });

  it('reports a render failure instead of throwing', async () => {
    vi.mocked(renderToBlob).mockRejectedValueOnce(new Error('canvas too large'));
    const { actions, store } = setup();
    await actions.download('png');
    expect(store.get().ui.toasts.at(-1)).toMatchObject({
      kind: 'error',
      text: 'The image could not be rendered',
    });
  });
});
