// The one place that knows which DOM-to-image library is in use (docs/decisions/0001-capture-library.md).
// Swapping libraries means rewriting renderToBlob and nothing else.
import { snapdom } from '@zumer/snapdom';
import { h } from '../render/h.ts';

export type CaptureType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface CaptureOptions {
  /** Output pixels per logical pixel (already clamped by the scale guard). */
  scale: number;
  type: CaptureType;
  /** 0–1, for JPEG and WebP. */
  quality?: number;
  /** Fill for formats without alpha. PNG stays transparent when this is null. */
  background?: string | null;
}

const FORMAT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const;

/** Safari sometimes draws the first capture without some images or fonts: do one throwaway capture first. */
const NEEDS_WARM_UP =
  typeof navigator !== 'undefined' &&
  /Safari\//.test(navigator.userAgent) &&
  !/Chrome|Chromium|Android|Firefox|FxiOS|CriOS/.test(navigator.userAgent);
let warmedUp = false;

async function whenReady(root: HTMLElement): Promise<void> {
  await document.fonts?.ready;
  await Promise.all(
    [...root.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)),
  );
}

async function capture(node: HTMLElement, options: CaptureOptions): Promise<Blob> {
  // Capture an unscaled clone in an off-screen host: the stage's preview transform must not leak in.
  const host = h('div', {
    'aria-hidden': 'true',
    style: {
      position: 'fixed',
      top: '0',
      left: '-20000px',
      width: `${node.offsetWidth}px`,
      pointerEvents: 'none',
    },
  });
  const clone = node.cloneNode(true) as HTMLElement;
  clone.style.transform = 'none';
  host.append(clone);
  document.body.append(host);
  try {
    await whenReady(clone);
    const result = await snapdom(clone, {
      scale: options.scale,
      dpr: 1,
      embedFonts: 'auto',
      backgroundColor:
        options.type === 'image/png'
          ? (options.background ?? null)
          : (options.background ?? '#ffffff'),
    });
    return await result.toBlob({
      format: FORMAT[options.type],
      quality: options.quality,
      scale: options.scale,
      dpr: 1,
    });
  } finally {
    host.remove();
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The capture timed out')), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Whether this browser can encode `type` at all (Firefox cannot write WebP, for instance). */
const IS_FIREFOX = typeof navigator !== 'undefined' && /Firefox\//.test(navigator.userAgent);

export function canEncode(type: CaptureType): boolean {
  if (type === 'image/png') return true;
  // snapdom 3.7.1's WebP export never settles in Firefox 150-series even though the canvas can encode
  // WebP. Re-test after upgrading either.
  if (type === 'image/webp' && IS_FIREFOX) return false;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    return canvas.toDataURL(type).startsWith(`data:${type}`);
  } catch {
    return false;
  }
}

export async function renderToBlob(node: HTMLElement, options: CaptureOptions): Promise<Blob> {
  if (NEEDS_WARM_UP && !warmedUp) {
    warmedUp = true;
    await capture(node, { ...options, scale: 0.25, type: 'image/png' }).catch(() => undefined);
  }
  try {
    return await withTimeout(
      capture(node, options),
      options.type === 'image/png' ? 120_000 : 20_000,
    );
  } catch (error) {
    // A format the browser cannot encode should still give the user a picture: fall back to PNG.
    if (options.type !== 'image/png') return capture(node, { ...options, type: 'image/png' });
    throw error;
  }
}
