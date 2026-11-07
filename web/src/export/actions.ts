// Copy, download and share (PLAN.md §8). The PNG is rendered in the background once the card has been
// still for 600 ms, so a click usually finds it ready; a click that arrives earlier renders on demand.
import { effective } from '../core/types.ts';
import type { AppState } from '../state/app-state.ts';
import { type Store, shallowEqual } from '../state/store.ts';
import { pushToast } from '../ui/toasts.ts';
import { type CaptureType, renderToBlob } from './capture.ts';
import { writePng } from './clipboard.ts';
import { canShareFile, downloadBlob } from './download.ts';
import { fileName } from './filename.ts';
import { exportHash } from './hash.ts';
import { clampScale, type ScaleResult } from './scale.ts';

const PRERENDER_MAX_PIXELS = 16_777_216;

export type ExportFormat = 'png' | 'jpeg' | 'webp';

export interface ExportActions {
  copy(): Promise<void>;
  download(format?: ExportFormat): Promise<void>;
  share(): Promise<void>;
  /** The size and scale the next export will use (after the scale guard). */
  plan(state: AppState): ScaleResult | null;
}

export interface ExportDeps {
  store: Store<AppState>;
  stage: { target(): HTMLElement | null; settled(): Promise<void> };
  /** Shows the "copy it yourself" dialog with the rendered image. */
  openFallback(blob: Blob): void;
  idleMs?: number;
}

const TYPES: Record<ExportFormat, CaptureType> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
const EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export function createExportActions(deps: ExportDeps): ExportActions {
  const { store, stage } = deps;
  let cache: { hash: string; scale: number; png: Promise<Blob> } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const plan = (s: AppState): ScaleResult | null => {
    const size = s.ui.measured;
    return size ? clampScale(size.width, size.height, s.style.export.scale) : null;
  };

  const cached = (s: AppState, scale: number): Promise<Blob> | null =>
    cache && cache.hash === exportHash(s) && cache.scale === scale ? cache.png : null;

  async function prerender(): Promise<void> {
    const s = store.get();
    if (s.phase !== 'editing' || !s.article) return;
    await stage.settled();
    const now = store.get();
    const node = stage.target();
    const guard = plan(now);
    const scale = guard?.scale;
    // Big outputs are rendered when asked for: a speculative 50-megapixel canvas can take a tab down.
    if (!node || !scale || !guard || guard.width * guard.height > PRERENDER_MAX_PIXELS) return;
    const png = renderToBlob(node, { scale, type: 'image/png' });
    const entry = { hash: exportHash(now), scale, png };
    cache = entry;
    png.catch(() => {
      if (cache === entry) cache = null;
    });
  }

  store.subscribe(
    (s) => [
      exportHash(s),
      s.phase,
      s.style.export.scale,
      s.ui.measured?.width,
      s.ui.measured?.height,
    ],
    () => {
      clearTimeout(timer);
      timer = setTimeout(() => void prerender(), deps.idleMs ?? 600);
    },
    { equals: shallowEqual },
  );

  const background = (node: HTMLElement): string | null => {
    const card = node.matches('.nc-card') ? node : node.querySelector<HTMLElement>('.nc-card');
    // renderCard sets --bg inline on the card root; the computed style is the fallback.
    return card
      ? card.style.getPropertyValue('--bg').trim() ||
          getComputedStyle(card).getPropertyValue('--bg').trim() ||
          null
      : null;
  };

  const name = (s: AppState, ext: string): string => {
    const f = s.article?.fields;
    let host = '';
    try {
      host = new URL(s.article?.citeUrl ?? '').hostname;
    } catch {
      host = 'card';
    }
    return fileName(
      {
        siteName: f ? effective(f.siteName) : null,
        host,
        published: f ? effective(f.published) : null,
        title: (f && effective(f.title)) || '',
      },
      ext,
    );
  };

  async function render(s: AppState, node: HTMLElement, format: ExportFormat): Promise<Blob> {
    const scale = plan(s)?.scale ?? s.style.export.scale;
    if (format === 'png') {
      const hit = cached(s, scale);
      if (hit) return hit;
    }
    return renderToBlob(node, {
      scale,
      type: TYPES[format],
      quality: s.style.export.quality,
      // JPEG has no alpha: fill with the card colour (the frame's own backdrop is part of the picture).
      background: format === 'png' ? null : background(node),
    });
  }

  return {
    plan,

    copy() {
      // Everything up to the clipboard call must happen synchronously, inside the user gesture.
      const s = store.get();
      const node = stage.target();
      const guard = plan(s);
      if (!node || !guard || s.phase !== 'editing') return Promise.resolve();
      const png =
        cached(s, guard.scale) ?? renderToBlob(node, { scale: guard.scale, type: 'image/png' });
      return writePng(png).then(
        () => {
          pushToast(
            store,
            `Copied ${guard.width}×${guard.height} PNG${guard.clamped ? ' (reduced to fit the browser limit)' : ''}`,
            'success',
          );
        },
        () => {
          // The browser refused (permissions, an unsupported type): show the image to copy by hand.
          png.then(
            (blob) => deps.openFallback(blob),
            () => pushToast(store, 'The image could not be rendered', 'error'),
          );
        },
      );
    },

    async download(format) {
      const s = store.get();
      const node = stage.target();
      if (!node || s.phase !== 'editing') return;
      const chosen = format ?? s.style.export.format;
      try {
        const blob = await render(s, node, chosen);
        // Trust the type the engine really produced: Safari may answer a WebP request with a PNG.
        const file = name(s, EXTENSION[blob.type] ?? 'png');
        downloadBlob(blob, file);
        pushToast(store, `Saved ${file}`, 'success');
      } catch {
        pushToast(store, 'The image could not be rendered', 'error');
      }
    },

    async share() {
      const s = store.get();
      const node = stage.target();
      if (!node || s.phase !== 'editing') return;
      try {
        const blob = await render(s, node, 'png');
        const file = new File([blob], name(s, 'png'), { type: 'image/png' });
        if (canShareFile(file)) await navigator.share({ files: [file] });
      } catch (error) {
        if ((error as { name?: string })?.name !== 'AbortError')
          pushToast(store, 'Sharing failed', 'error');
      }
    },
  };
}
