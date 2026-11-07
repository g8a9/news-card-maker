// The M5 capture-library spike (docs/decisions/0001-capture-library.md): runs modern-screenshot and
// @zumer/snapdom on the card currently on the page and compares each result with what the browser
// itself rendered. Loaded only by /dev/gallery.html?spike=1; driven by tests/e2e/spike.spec.ts.
import { snapdom } from '@zumer/snapdom';
import { domToBlob } from 'modern-screenshot';

export type Lib = 'modern-screenshot' | 'snapdom';

const target = (): HTMLElement =>
  (document.querySelector('.nc-frame') ?? document.querySelector('.nc-card')) as HTMLElement;

const toDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

async function load(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

async function capture(lib: Lib, scale: number) {
  const started = performance.now();
  let blob: Blob;
  if (lib === 'modern-screenshot') {
    blob = await domToBlob(target(), { scale, type: 'image/png' });
  } else {
    const result = await snapdom(target(), { scale, dpr: 1 });
    blob = await result.toBlob({ format: 'png', scale, dpr: 1 });
  }
  const ms = performance.now() - started;
  const bitmap = await createImageBitmap(blob);
  return { ms, width: bitmap.width, height: bitmap.height, dataUrl: await toDataUrl(blob) };
}

/** Fraction of pixels that differ visibly, and the mean per-channel error, after compositing on grey. */
async function diff(referenceDataUrl: string, outputDataUrl: string) {
  const [ref, out] = await Promise.all([load(referenceDataUrl), load(outputDataUrl)]);
  const w = ref.naturalWidth;
  const h = ref.naturalHeight;
  const draw = (img: HTMLImageElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  };
  const a = draw(ref);
  const b = draw(out);
  let bad = 0;
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(
      Math.abs((a[i] as number) - (b[i] as number)),
      Math.abs((a[i + 1] as number) - (b[i + 1] as number)),
      Math.abs((a[i + 2] as number) - (b[i + 2] as number)),
    );
    sum += d;
    if (d > 32) bad++;
  }
  const pixels = a.length / 4;
  return {
    differing: bad / pixels,
    meanError: sum / pixels,
    sizeMatches: out.naturalWidth === ref.naturalWidth && out.naturalHeight === ref.naturalHeight,
    reference: [ref.naturalWidth, ref.naturalHeight],
    output: [out.naturalWidth, out.naturalHeight],
  };
}

export function installSpike(): void {
  (window as unknown as { __spike: unknown }).__spike = { capture, diff };
}
