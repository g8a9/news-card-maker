// Image effects are baked on a canvas, never applied with CSS filters, which export unreliably
// (PLAN.md §8.4, §7.6). Results are data URLs cached by source and effect.

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

const MAX_WIDTH = 2400;
const cache = new Map<string, Promise<string>>();

function canvasFor(img: HTMLImageElement): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const scale = Math.min(1, MAX_WIDTH / (img.naturalWidth || 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
  canvas.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D canvas available');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

export type BakedFilter = 'grayscale' | 'dim';

export function bakeImage(src: string, filter: BakedFilter): Promise<string> {
  const key = `${src}|${filter}`;
  let cached = cache.get(key);
  if (!cached) {
    cached = (async () => {
      const { canvas, ctx } = canvasFor(await loadImage(src));
      if (filter === 'grayscale') {
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = frame.data;
        for (let i = 0; i < d.length; i += 4) {
          const y =
            0.2126 * (d[i] as number) +
            0.7152 * (d[i + 1] as number) +
            0.0722 * (d[i + 2] as number);
          d[i] = d[i + 1] = d[i + 2] = y;
        }
        ctx.putImageData(frame, 0, 0);
      } else {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      return canvas.toDataURL('image/jpeg', 0.92);
    })();
    cache.set(key, cached);
  }
  return cached;
}

/**
 * The Frame's "Blur" background (PLAN.md §7.6): the featured image, soft and dimmed. Instead of a
 * CSS or canvas blur filter, the image is shrunk to a handful of pixels and smoothly scaled back up,
 * which looks like a blur everywhere and needs no filter support.
 */
export function blurredBackdrop(src: string): Promise<string> {
  const key = `${src}|blur`;
  let cached = cache.get(key);
  if (!cached) {
    cached = (async () => {
      const img = await loadImage(src);
      const aspect = (img.naturalHeight || 1) / (img.naturalWidth || 1);
      const small = document.createElement('canvas');
      small.width = 32;
      small.height = Math.max(2, Math.round(32 * aspect));
      const sctx = small.getContext('2d');
      const out = document.createElement('canvas');
      out.width = 640;
      out.height = Math.max(2, Math.round(640 * aspect));
      const octx = out.getContext('2d');
      if (!sctx || !octx) throw new Error('No 2D canvas available');
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(img, 0, 0, small.width, small.height);
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = 'high';
      // Scale 1.2× around the centre so the soft edges never show, then dim.
      const w = out.width * 1.2;
      const h = out.height * 1.2;
      octx.drawImage(small, (out.width - w) / 2, (out.height - h) / 2, w, h);
      octx.fillStyle = 'rgba(0, 0, 0, 0.32)';
      octx.fillRect(0, 0, out.width, out.height);
      return out.toDataURL('image/jpeg', 0.85);
    })();
    cache.set(key, cached);
  }
  return cached;
}
