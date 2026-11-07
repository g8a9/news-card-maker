// The scale guard (PLAN.md §8.1): canvases have area limits, and iOS/iPadOS Safari's is the tightest.

export const MAX_PIXELS_IOS = 16_777_216; // 4096 × 4096
export const MAX_PIXELS_DEFAULT = 50_000_000;

export function isIOS(
  ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  platform: string = typeof navigator === 'undefined' ? '' : navigator.platform,
  touchPoints: number = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints,
): boolean {
  // iPadOS reports itself as a Mac with a touch screen.
  return /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && touchPoints > 1);
}

export interface ScaleResult {
  /** The scale actually used: the requested one, or the largest that fits the limit. */
  scale: number;
  clamped: boolean;
  /** Output size in pixels at that scale. */
  width: number;
  height: number;
}

export function clampScale(
  width: number,
  height: number,
  requested: number,
  maxPixels: number = isIOS() ? MAX_PIXELS_IOS : MAX_PIXELS_DEFAULT,
): ScaleResult {
  const limit = Math.sqrt(maxPixels / Math.max(1, width * height));
  const scale = requested <= limit ? requested : Math.max(0.1, Math.floor(limit * 100) / 100);
  return {
    scale,
    clamped: scale < requested,
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}
