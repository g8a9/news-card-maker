// Fonts (PLAN.md §7.5): families, fallback stacks that cover CJK, Arabic, Hebrew and emoji, and
// loading the faces a card needs before it is measured or exported.
import type { Outlet } from '../core/registry.ts';
import type { CardStyle, FontId, ThemeId } from './style.ts';

export interface FontDef {
  id: FontId;
  label: string;
  kind: 'serif' | 'sans' | 'mono';
  /** The @font-face family name from Fontsource, or null for the system stack. */
  face: string | null;
  stack: string;
}

const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"';
const CJK_SANS =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans CJK JP", "PingFang SC", "PingFang TC", "Noto Sans CJK SC", "Malgun Gothic", "Noto Sans CJK KR"';
const CJK_SERIF =
  '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", "Songti SC", "Noto Serif CJK SC", "AppleMyungjo", "Noto Serif CJK KR"';
const RTL_SANS =
  '"Noto Sans Arabic", "Geeza Pro", "Segoe UI", "Noto Sans Hebrew", "Arial Hebrew", Arial';
const RTL_SERIF = '"Noto Naskh Arabic", "Geeza Pro", "Noto Serif Hebrew", "Times New Roman"';

const sansStack = (head: string) =>
  `${head}, system-ui, -apple-system, "Segoe UI", Roboto, ${CJK_SANS}, ${RTL_SANS}, ${EMOJI}, sans-serif`;
const serifStack = (head: string) =>
  `${head}, Georgia, "Times New Roman", ${CJK_SERIF}, ${RTL_SERIF}, ${EMOJI}, serif`;

export const FONTS: Record<FontId, FontDef> = {
  newsreader: {
    id: 'newsreader',
    label: 'Newsreader',
    kind: 'serif',
    face: 'Newsreader Variable',
    stack: serifStack('"Newsreader Variable"'),
  },
  'source-serif': {
    id: 'source-serif',
    label: 'Source Serif',
    kind: 'serif',
    face: 'Source Serif 4 Variable',
    stack: serifStack('"Source Serif 4 Variable"'),
  },
  inter: {
    id: 'inter',
    label: 'Inter',
    kind: 'sans',
    face: 'Inter Variable',
    stack: sansStack('"Inter Variable"'),
  },
  'inter-tight': {
    id: 'inter-tight',
    label: 'Inter Tight',
    kind: 'sans',
    face: 'Inter Tight Variable',
    stack: sansStack('"Inter Tight Variable"'),
  },
  'jetbrains-mono': {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono',
    kind: 'mono',
    face: 'JetBrains Mono Variable',
    stack: `"JetBrains Mono Variable", ui-monospace, "SF Mono", Menlo, Consolas, ${CJK_SANS}, ${EMOJI}, monospace`,
  },
  system: {
    id: 'system',
    label: 'System',
    kind: 'sans',
    face: null,
    stack: sansStack('system-ui'),
  },
};

export const HEADLINE_FONT_CHOICES: FontId[] = [
  'newsreader',
  'source-serif',
  'inter-tight',
  'inter',
  'system',
];
export const BODY_FONT_CHOICES: FontId[] = [
  'inter',
  'inter-tight',
  'newsreader',
  'source-serif',
  'system',
];

/** Headline weight: 600 for serif, 650 for sans (PLAN.md §7.2). */
export const headlineWeight = (id: FontId): number => (FONTS[id].kind === 'serif' ? 600 : 650);

/**
 * "Auto" headline font: the user's choice, else the outlet's category hint, else Newsreader.
 * The Paper theme defaults to serif.
 */
export function resolveHeadlineFont(
  style: CardStyle,
  theme: ThemeId,
  outlet?: Outlet | null,
): FontId {
  if (style.fonts.headline !== 'auto') return style.fonts.headline;
  const hint = outlet?.fonts?.headline;
  if (hint === 'sans') return 'inter-tight';
  if (hint === 'serif') return 'newsreader';
  return theme === 'paper' ? 'newsreader' : 'newsreader';
}

/** Loads the faces a card uses, with its own text, so the right unicode-range subsets download. */
export async function loadCardFonts(fonts: FontId[], text: string): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const sample = text.slice(0, 600);
  const jobs: Promise<unknown>[] = [];
  for (const id of new Set(fonts)) {
    const def = FONTS[id];
    if (!def.face) continue;
    const weights = def.kind === 'serif' ? [600, 400] : [650, 500, 400];
    for (const weight of weights) {
      jobs.push(document.fonts.load(`${weight} 32px "${def.face}"`, sample).catch(() => []));
    }
  }
  await Promise.all(jobs);
  await document.fonts.ready;
}
