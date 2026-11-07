// CardStyle: everything the user can change about how a card looks (PLAN.md §10), its defaults,
// and the size presets of §7.3.

export type TemplateId = 'classic' | 'split' | 'headline' | 'hero' | 'browser' | 'strip';
export type ThemeId = 'light' | 'dark' | 'brand' | 'paper' | 'image' | 'mono';
export type FontId =
  | 'newsreader'
  | 'source-serif'
  | 'inter'
  | 'inter-tight'
  | 'jetbrains-mono'
  | 'system';
export type SizePreset =
  | 'auto'
  | '16:9'
  | '4:3'
  | '3:2'
  | '1.91:1'
  | '2:1'
  | '1:1'
  | '4:5'
  | '9:16'
  | 'custom';

export interface FrameStyle {
  enabled: boolean;
  background: {
    kind: 'transparent' | 'solid' | 'gradient' | 'brand' | 'blur';
    /** Colour for `solid`, gradient id for `gradient`. */
    value?: string;
  };
  /** In u, 0–20. */
  padding: number;
  shadow: 'none' | 'soft' | 'medium' | 'strong';
}

export interface CardStyle {
  v: 1;
  template: TemplateId;
  size: { preset: SizePreset; width: number; height: number | null };
  theme: ThemeId;
  /** null = automatic (the brand colour, adjusted for contrast). */
  accent: string | null;
  fonts: { headline: 'auto' | FontId; body: FontId };
  /** Multiplies the headline size, 0.8–1.25. */
  headlineScale: number;
  align: 'start' | 'center';
  density: 'compact' | 'regular' | 'airy';
  /** Card corner radius in u, 0–4. */
  radius: number;
  border: 'none' | 'hairline';
  logoStyle: 'auto' | 'original' | 'mono';
  imageFilter: 'none' | 'grayscale' | 'dim' | 'duotone';
  /** Focal point, 0–1 on each axis. */
  imageFocus: { x: number; y: number };
  /** 1–2.5. */
  imageZoom: number;
  imagePosition: 'top' | 'start' | 'end';
  show: {
    image: boolean;
    logo: boolean;
    siteName: 'auto' | boolean;
    kicker: boolean;
    description: boolean;
    authors: boolean;
    date: boolean;
    updated: boolean;
    accessed: boolean;
    url: boolean;
    qr: boolean;
  };
  urlStyle: 'clean' | 'full' | 'domain';
  dateFormat: 'long' | 'medium' | 'short' | 'iso';
  /** 'auto' = the viewer's browser language, 'article' = the article's language, or a BCP 47 tag. */
  locale: 'auto' | 'article' | string;
  frame: FrameStyle;
  export: { format: 'png' | 'jpeg' | 'webp'; scale: 1 | 2 | 3 | 4; quality: number };
}

export function defaultStyle(): CardStyle {
  return {
    v: 1,
    template: 'classic',
    size: { preset: 'auto', width: 1200, height: null },
    theme: 'light',
    accent: null,
    fonts: { headline: 'auto', body: 'inter' },
    headlineScale: 1,
    align: 'start',
    density: 'regular',
    radius: 1.6,
    border: 'none',
    logoStyle: 'auto',
    imageFilter: 'none',
    imageFocus: { x: 0.5, y: 0.5 },
    imageZoom: 1,
    imagePosition: 'end',
    show: {
      image: true,
      logo: true,
      siteName: 'auto',
      kicker: false,
      description: true,
      authors: false,
      date: true,
      updated: false,
      accessed: false,
      url: true,
      qr: false,
    },
    urlStyle: 'clean',
    dateFormat: 'medium',
    locale: 'auto',
    frame: {
      enabled: false,
      background: { kind: 'solid', value: '#E8E8EC' },
      padding: 6,
      shadow: 'soft',
    },
    export: { format: 'png', scale: 2, quality: 0.92 },
  };
}

/** Logical sizes of the presets (PLAN.md §7.3). `auto` has no fixed height. */
export const SIZE_PRESETS: Record<Exclude<SizePreset, 'auto' | 'custom'>, [number, number]> = {
  '16:9': [1200, 675],
  '4:3': [1200, 900],
  '3:2': [1200, 800],
  '1.91:1': [1200, 628],
  '2:1': [1200, 600],
  '1:1': [1080, 1080],
  '4:5': [1080, 1350],
  '9:16': [1080, 1920],
};

export const WIDTH_LIMITS = { min: 600, max: 2000 } as const;
export const CUSTOM_LIMITS = { min: 320, max: 4000 } as const;

export interface ResolvedSize {
  width: number;
  /** null: the height follows the content. */
  height: number | null;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function resolveSize(size: CardStyle['size']): ResolvedSize {
  if (size.preset === 'auto') {
    return {
      width: clamp(Math.round(size.width), WIDTH_LIMITS.min, WIDTH_LIMITS.max),
      height: null,
    };
  }
  if (size.preset === 'custom') {
    return {
      width: clamp(Math.round(size.width), CUSTOM_LIMITS.min, CUSTOM_LIMITS.max),
      height: clamp(Math.round(size.height ?? size.width), CUSTOM_LIMITS.min, CUSTOM_LIMITS.max),
    };
  }
  const [width, height] = SIZE_PRESETS[size.preset];
  return { width, height };
}

/** Orientation class used by templates to pick proportions. */
export function orientationOf(size: ResolvedSize): 'landscape' | 'square' | 'portrait' {
  if (size.height === null) return 'landscape';
  const ratio = size.width / size.height;
  return ratio >= 1.2 ? 'landscape' : ratio >= 0.8 ? 'square' : 'portrait';
}
