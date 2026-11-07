// Tiny colour helpers for metadata values. Colour math (OKLCH, contrast) lives in brand/theme.ts.

const NAMED: Record<string, string> = { black: '#000000', white: '#FFFFFF' };

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `black`/`white` → `#RRGGBB`, or null. */
export function normalizeColor(input: string | null | undefined): string | null {
  const s = input?.trim().toLowerCase();
  if (!s) return null;
  if (s in NAMED) return NAMED[s] as string;
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) {
    const [r, g, b] = (m[1] as string).split('');
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(s);
  if (m) return `#${(m[1] as string).toUpperCase()}`;
  m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(s);
  if (m) {
    const parts = [m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)));
    return `#${parts.map((p) => p.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  }
  return null;
}

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

const toLinear = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** sRGB hex → OKLCH (lightness 0–1, chroma ~0–0.4, hue in degrees). */
export function toOklch(hex: string): Oklch | null {
  const n = normalizeColor(hex);
  if (!n) return null;
  const r = toLinear(Number.parseInt(n.slice(1, 3), 16));
  const g = toLinear(Number.parseInt(n.slice(3, 5), 16));
  const b = toLinear(Number.parseInt(n.slice(5, 7), 16));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

/** Near-greys and near-black/white are not brand accents (PLAN.md §6.5). */
export function isNeutralColor(hex: string): boolean {
  const c = toOklch(hex);
  return !c || c.c < 0.03 || c.l > 0.97 || c.l < 0.12;
}
