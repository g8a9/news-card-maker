// Logo treatments (PLAN.md §6.4). Recolouring happens on a canvas and exports a PNG data URL, so it
// works the same for raster and SVG logos and survives export (no CSS mask-image).
import type { LoadedLogo } from '../core/types.ts';
import type { CardStyle, ThemeId } from '../render/style.ts';

export interface LogoStats {
  /** All four corners are opaque and alike: an app-icon style logo with its own background. */
  opaqueCorners: boolean;
  /** Mean luminance (0–1) of the opaque pixels. */
  fgLuminance: number;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

const luminance = (r: number, g: number, b: number): number =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

const stats = new Map<string, Promise<LogoStats | null>>();

/** Cheap logo analysis on a ≤64 px canvas. Null when the canvas is tainted or the image fails. */
export function logoStats(src: string): Promise<LogoStats | null> {
  let cached = stats.get(src);
  if (!cached) {
    cached = (async () => {
      try {
        const img = await loadImage(src);
        const w = 64;
        const h = Math.max(
          1,
          Math.round((64 * (img.naturalHeight || 1)) / (img.naturalWidth || 1)),
        );
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);
        const at = (x: number, y: number) => {
          const i = (y * w + x) * 4;
          return [
            data[i] as number,
            data[i + 1] as number,
            data[i + 2] as number,
            data[i + 3] as number,
          ] as const;
        };
        const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
        const similar = corners.every(
          (c) =>
            Math.abs(c[0] - corners[0][0]) +
              Math.abs(c[1] - corners[0][1]) +
              Math.abs(c[2] - corners[0][2]) <
            40,
        );
        const opaqueCorners = corners.every((c) => c[3] > 250) && similar;
        let sum = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          if ((data[i + 3] as number) > 128) {
            sum += luminance(data[i] as number, data[i + 1] as number, data[i + 2] as number);
            count++;
          }
        }
        return { opaqueCorners, fgLuminance: count ? sum / count : 0 };
      } catch {
        return null; // tainted canvas or undecodable: treat as valid with unknown colours
      }
    })();
    stats.set(src, cached);
  }
  return cached;
}

const recoloured = new Map<string, Promise<string>>();

/** Paints every opaque pixel of the logo in `color`; transparency is kept. Returns a PNG data URL. */
export function recolorLogo(src: string, color: string, isSvg = false): Promise<string> {
  const key = `${src}|${color}`;
  let cached = recoloured.get(key);
  if (!cached) {
    cached = (async () => {
      const img = await loadImage(src);
      const naturalW = img.naturalWidth || 300;
      const naturalH = img.naturalHeight || 100;
      // Rasterise SVGs at ≥ 1024 px wide so the logo stays crisp on a 4× export.
      const scale = isSvg ? Math.max(1, 1024 / naturalW) : Math.min(1, 2048 / naturalW);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(naturalW * scale));
      canvas.height = Math.max(1, Math.round(naturalH * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No 2D canvas available');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    })();
    recoloured.set(key, cached);
  }
  return cached;
}

export type LogoTreatment = 'original' | 'mono';

/**
 * "Auto" (PLAN.md §6.4): dark, brand and mono-ink themes use a mono logo in the theme's ink colour,
 * unless the logo has an opaque background of its own; light and paper themes keep the original,
 * unless the logo is white (then it goes mono dark). Registry hints win over auto.
 */
export function chooseTreatment(input: {
  choice: CardStyle['logoStyle'];
  theme: ThemeId;
  stats: LogoStats | null;
  hint?: 'mono' | 'original';
}): LogoTreatment {
  if (input.choice !== 'auto') return input.choice;
  if (input.hint) return input.hint;
  const darkSurface = input.theme === 'dark' || input.theme === 'brand' || input.theme === 'image';
  if (input.theme === 'mono') return 'mono';
  if (darkSurface) return input.stats?.opaqueCorners ? 'original' : 'mono';
  if (input.stats && !input.stats.opaqueCorners && input.stats.fgLuminance > 0.8) return 'mono';
  return 'original';
}

/** First letter for the monogram fallback: skips articles and punctuation. */
export function monogramLetter(name: string): string {
  const cleaned = name.replace(/^(the|la|il|le|el|der|die|das)\s+/i, '').trim();
  const match = cleaned.match(/\p{L}|\p{N}/u);
  return (match?.[0] ?? '•').toUpperCase();
}

export const isSvgLogo = (logo: LoadedLogo): boolean =>
  logo.ref.mime?.includes('svg') === true || /\.svg(\?|$)/i.test(logo.ref.url);
