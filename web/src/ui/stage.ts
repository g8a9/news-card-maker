// The stage (PLAN.md §7.1, §9.3): renders the card, fits its text, scales it to the available space,
// and handles the direct manipulations: click a text to jump to its field, drag the image to move
// its focal point, drop an image to replace it.

import type { Outlet } from '../core/registry.ts';
import { findOutletById } from '../core/registry.ts';
import { prepareAssets } from '../render/assets.ts';
import { type RenderedCard, renderCard } from '../render/card.ts';
import { type FitReport, fitCard } from '../render/fit.ts';
import { loadCardFonts } from '../render/fonts.ts';
import { h } from '../render/h.ts';
import type { AppState } from '../state/app-state.ts';
import type { Store } from '../state/store.ts';
import { shallowEqual } from '../state/store.ts';

export interface StageDeps {
  outlets: readonly Outlet[];
  hostLocale: string;
  /** Called when the user clicks a piece of text on the card. */
  focusField(id: string): void;
  /** Called when an image file is dropped on the stage. */
  dropImage(file: File): void;
}

export interface Stage {
  element: HTMLElement;
  /** The element to export: the frame when enabled, else the card. */
  target(): HTMLElement | null;
  /** Re-measure and rescale (after a resize or a layout change around the stage). */
  relayout(): void;
  /** Resolves when the card currently on screen reflects the latest state. */
  settled(): Promise<void>;
  destroy(): void;
}

/** Which field each part of the card belongs to. */
const FIELD_FOR: Array<[string, string]> = [
  ['.nc-headline', 'title'],
  ['.nc-deck', 'description'],
  ['.nc-kicker', 'kicker'],
  ['.nc-logo, .nc-monogram, .nc-site', 'logo'],
  ['.nc-meta-start', 'published'],
  ['.nc-meta-url', 'url'],
];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function createStage(store: Store<AppState>, deps: StageDeps): Stage {
  const scaler = h('div', { class: 'stage-scaler', role: 'img' });
  const sizer = h('div', { class: 'stage-sizer' }, scaler);
  const viewport = h('div', { class: 'stage-viewport' }, sizer);
  const staging = h('div', { class: 'stage-staging', 'aria-hidden': 'true' });
  const status = h('p', { class: 'stage-status', 'aria-live': 'polite' });
  const element = h(
    'div',
    { class: 'stage', dataset: { empty: 'true' } },
    viewport,
    status,
    staging,
  );

  let current: RenderedCard | null = null;
  let token = 0;
  let pending: Promise<void> = Promise.resolve();

  const skeleton = () =>
    h(
      'div',
      { class: 'skeleton-card', style: { '--u': '12px', '--w': '1200px' } },
      h('div', { class: 'skeleton-media shimmer' }),
      h(
        'div',
        { class: 'skeleton-body' },
        h('div', { class: 'skeleton-line shimmer', style: { width: '28%', height: '3.2em' } }),
        h('div', { class: 'skeleton-line shimmer', style: { width: '92%', height: '5em' } }),
        h('div', { class: 'skeleton-line shimmer', style: { width: '78%', height: '5em' } }),
        h('div', { class: 'skeleton-line shimmer', style: { width: '60%', height: '2.2em' } }),
      ),
    );

  function measure(): { width: number; height: number } | null {
    const root = current?.root ?? (scaler.firstElementChild as HTMLElement | null);
    if (!root) return null;
    return { width: root.offsetWidth, height: root.offsetHeight };
  }

  function scaleToFit(): void {
    const size = measure();
    if (!size || size.width === 0 || size.height === 0) return;
    const pad = 32;
    const availW = Math.max(120, viewport.clientWidth - pad);
    const availH = Math.max(120, viewport.clientHeight - pad);
    const scale = Math.min(1, availW / size.width, availH / size.height);
    scaler.style.transform = `scale(${scale})`;
    sizer.style.width = `${size.width * scale}px`;
    sizer.style.height = `${size.height * scale}px`;
    scaler.dataset.scale = String(scale);
  }

  async function decodeImages(root: HTMLElement): Promise<void> {
    await Promise.all(
      [...root.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)),
    );
  }

  async function render(): Promise<void> {
    const mine = ++token;
    const { article, style, phase } = store.get();
    if (!article) {
      current = null;
      scaler.replaceChildren(phase === 'loading' ? skeleton() : '');
      element.dataset.empty = phase === 'loading' ? 'false' : 'true';
      scaler.setAttribute('aria-label', 'Loading preview');
      scaleToFit();
      return;
    }
    const outlet = findOutletById(deps.outlets, article.brand.outletId ?? '');
    const assets = await prepareAssets(article, style, outlet);
    if (mine !== token) return;
    const rendered = renderCard({ article, style, outlet, assets, hostLocale: deps.hostLocale });

    // Fit off-screen, in the same layout the card will have, then swap: no flash of unfitted text.
    staging.replaceChildren(rendered.root);
    await loadCardFonts(rendered.fonts, rendered.text);
    if (mine !== token) return;
    await decodeImages(rendered.root);
    if (mine !== token) return;
    const report: FitReport = fitCard(rendered.card);

    current = rendered;
    scaler.replaceChildren(rendered.root);
    scaler.setAttribute('aria-label', rendered.alt);
    element.dataset.empty = 'false';
    const accent = rendered.card.style.getPropertyValue('--accent');
    sizer.style.setProperty('--ring', accent ? `${accent}66` : 'transparent');
    scaleToFit();

    const size = measure();
    store.set((s) => {
      const sameFit = JSON.stringify(s.fit) === JSON.stringify(report);
      const sameSize =
        s.ui.measured?.width === size?.width && s.ui.measured?.height === size?.height;
      if (sameFit && sameSize) return s;
      return { ...s, fit: report, ui: { ...s.ui, measured: size } };
    });
  }

  const schedule = () => {
    pending = render().catch(() => undefined);
  };
  const unsubscribe = store.subscribe((s) => [s.article, s.style, s.phase], schedule, {
    equals: shallowEqual,
    immediate: true,
  });
  // Fonts that finish loading late change text metrics: fit again.
  const onFonts = () => schedule();
  document.fonts?.addEventListener?.('loadingdone', onFonts);

  const resizeObserver = new ResizeObserver(() => scaleToFit());
  resizeObserver.observe(viewport);

  // Click a piece of text: jump to its field in the panel.
  scaler.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    if (!target || drag) return;
    for (const [selector, field] of FIELD_FOR) {
      if (target.closest(selector)) return deps.focusField(field);
    }
  });

  // Drag the image to move its focal point.
  let drag: {
    x: number;
    y: number;
    fx: number;
    fy: number;
    w: number;
    h: number;
    scale: number;
    img: HTMLElement;
    moved: boolean;
  } | null = null;
  element.addEventListener('pointerdown', (event) => {
    const media = (event.target as Element | null)?.closest<HTMLElement>('.nc-media');
    const img = media?.querySelector<HTMLElement>('img');
    if (!media || !img || event.button !== 0) return;
    const scale = Number(scaler.dataset.scale ?? 1) || 1;
    const focus = store.get().style.imageFocus;
    drag = {
      x: event.clientX,
      y: event.clientY,
      fx: focus.x,
      fy: focus.y,
      w: media.offsetWidth,
      h: media.offsetHeight,
      scale,
      img,
      moved: false,
    };
    element.setPointerCapture(event.pointerId);
    element.classList.add('is-dragging');
  });
  element.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = (event.clientX - drag.x) / drag.scale;
    const dy = (event.clientY - drag.y) / drag.scale;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    // Dragging the picture right reveals more of its left side, so the focal point moves left.
    const fx = clamp01(drag.fx - dx / drag.w);
    const fy = clamp01(drag.fy - dy / drag.h);
    drag.img.style.setProperty('--fx', `${fx * 100}%`);
    drag.img.style.setProperty('--fy', `${fy * 100}%`);
    drag.img.dataset.fx = String(fx);
    drag.img.dataset.fy = String(fy);
  });
  const endDrag = () => {
    if (!drag) return;
    const { img, moved } = drag;
    element.classList.remove('is-dragging');
    if (moved) {
      const x = Number(img.dataset.fx);
      const y = Number(img.dataset.fy);
      store.set((s) => ({ ...s, style: { ...s.style, imageFocus: { x, y } } }));
    }
    // The click that ends a drag must not count as a click on the card.
    setTimeout(() => {
      drag = null;
    }, 0);
  };
  element.addEventListener('pointerup', endDrag);
  element.addEventListener('pointercancel', endDrag);

  // Drop an image file onto the stage.
  element.addEventListener('dragover', (event) => {
    if ([...(event.dataTransfer?.items ?? [])].some((i) => i.kind === 'file')) {
      event.preventDefault();
      element.classList.add('is-drop');
    }
  });
  element.addEventListener('dragleave', () => element.classList.remove('is-drop'));
  element.addEventListener('drop', (event) => {
    element.classList.remove('is-drop');
    const file = [...(event.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (file) {
      event.preventDefault();
      deps.dropImage(file);
    }
  });

  // The status line under the preview: what was hidden to fit, and notes about the source.
  store.subscribe(
    (s) => [s.fit, s.notices],
    () => {
      const s = store.get();
      status.textContent = [
        ...s.notices,
        s.fit && s.fit.hidden.length > 0 ? describeHidden(s.fit) : '',
      ]
        .filter(Boolean)
        .join(' · ');
    },
    { equals: () => false, immediate: true },
  );

  return {
    element,
    target: () => current?.root ?? null,
    relayout: scaleToFit,
    settled: () => pending,
    destroy() {
      unsubscribe();
      resizeObserver.disconnect();
      document.fonts?.removeEventListener?.('loadingdone', onFonts);
    },
  };
}

function describeHidden(fit: FitReport): string {
  const names: Record<string, string> = {
    description: 'Subtitle',
    kicker: 'Kicker',
    authors: 'Author',
  };
  const what = fit.hidden.map((f) => names[f]).join(', ');
  return `${what} hidden to fit: try Auto height or a taller size`;
}
