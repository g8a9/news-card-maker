// Loading images and logos through the proxy (PLAN.md §6.3). The result is a same-origin blob, so
// there is no canvas taint and exports stay clean: fetch → blob → object URL → img.decode().
import type { ImageRef, LoadedImage, LoadedLogo, LogoAnalysis, LogoRef } from '../core/types.ts';
import { type FetchOptions, fetchBlob } from './proxy.ts';

export interface ImageDimensions {
  width: number;
  height: number;
}

/** SVGs may report 0×0 in Firefox; read the intrinsic size from the markup instead. */
export async function svgSizeFromBlob(blob: Blob): Promise<ImageDimensions | null> {
  const text = (await blob.slice(0, 4096).text()).slice(0, 4096);
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!tag) return null;
  const attr = (name: string) =>
    new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)?.[1];
  const w = Number.parseFloat(attr('width') ?? '');
  const h = Number.parseFloat(attr('height') ?? '');
  if (w > 0 && h > 0) return { width: w, height: h };
  const box = (attr('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (box.length === 4 && (box[2] as number) > 0 && (box[3] as number) > 0) {
    return { width: box[2] as number, height: box[3] as number };
  }
  return null;
}

/** Decodes a blob in the browser and returns its natural size. */
export async function decodeInBrowser(blob: Blob, objectUrl: string): Promise<ImageDimensions> {
  const img = new Image();
  img.decoding = 'async';
  img.src = objectUrl;
  await img.decode();
  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
    return { width: img.naturalWidth, height: img.naturalHeight };
  }
  const fromSvg = blob.type.includes('svg') ? await svgSizeFromBlob(blob) : null;
  if (fromSvg) return fromSvg;
  throw new Error('Image has no intrinsic size');
}

export interface ImageLoadOptions extends FetchOptions {
  /** Replaceable for tests and non-browser runs. */
  decode?: (blob: Blob, objectUrl: string) => Promise<ImageDimensions>;
}

async function loadBlob(
  proxy: string,
  url: string,
  options: ImageLoadOptions,
): Promise<{ blob: Blob; objectUrl: string } & ImageDimensions> {
  const blob = await fetchBlob(proxy, url, options);
  const objectUrl = URL.createObjectURL(blob);
  try {
    const size = await (options.decode ?? decodeInBrowser)(blob, objectUrl);
    return { blob, objectUrl, ...size };
  } catch (e) {
    URL.revokeObjectURL(objectUrl);
    throw e;
  }
}

export async function loadImage(
  proxy: string,
  ref: ImageRef,
  options: ImageLoadOptions = {},
): Promise<LoadedImage> {
  const { objectUrl, width, height } = await loadBlob(proxy, ref.url, options);
  return { ref: { ...ref, width, height }, objectUrl, width, height };
}

/** A logo is acceptable when it loads, is at least 24 px tall, and is not an extreme portrait. */
export function logoLooksUsable(size: ImageDimensions): boolean {
  return size.width / size.height >= 0.5 && size.height >= 24;
}

export async function loadLogo(
  proxy: string,
  ref: LogoRef,
  options: ImageLoadOptions = {},
): Promise<LoadedLogo> {
  const { objectUrl, width, height } = await loadBlob(proxy, ref.url, options);
  const aspect = width / height;
  if (!logoLooksUsable({ width, height })) {
    URL.revokeObjectURL(objectUrl);
    throw new Error('Logo is too small or the wrong shape');
  }
  // The real shape decides: a wide logo is a wordmark, a squarish one an icon. Favicons stay favicons.
  const kind: LogoRef['kind'] =
    ref.kind === 'favicon' || ref.kind === 'monogram'
      ? ref.kind
      : aspect >= 1.8
        ? 'wordmark'
        : 'icon';
  const analysis: LogoAnalysis = { aspect };
  return { ref: { ...ref, kind, width, height }, objectUrl, width, height, analysis };
}

/** Frees the blob URLs held by an image or logo that is no longer shown. */
export function revokeLoaded(item: { objectUrl: string } | null | undefined): void {
  if (item?.objectUrl.startsWith('blob:')) URL.revokeObjectURL(item.objectUrl);
}
