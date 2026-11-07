// The settings panel is generated from this table (PLAN.md §9.4). Each control names where its value
// lives (`path`), how to show it (`type`), and when it applies (`visibleIf`).
import { FONTS } from '../../render/fonts.ts';
import type { AppState } from '../../state/app-state.ts';
import type { IconName } from '../icons.ts';

export interface Option {
  value: string | number | boolean | null;
  label: string;
  icon?: IconName;
  title?: string;
}

interface Base {
  id: string;
  label: string;
  help?: string;
  visibleIf?: (s: AppState) => boolean;
}

export type Control = Base &
  (
    | {
        type: 'text' | 'textarea';
        path: string;
        rows?: number;
        placeholder?: string;
        show?: string;
        alternatives?: boolean;
      }
    | { type: 'authors'; path: string; show?: string }
    | { type: 'date'; path: string; show?: string }
    | { type: 'toggle'; path: string }
    | { type: 'select'; path: string; options: Option[]; show?: string }
    | { type: 'segmented'; path: string; options: Option[]; show?: string }
    | {
        type: 'slider';
        path: string;
        min: number;
        max: number;
        step: number;
        format?: (n: number) => string;
      }
    | { type: 'swatches'; path: string }
    | { type: 'size' }
    | { type: 'image' }
    | { type: 'logo' }
    | { type: 'readonly'; text: (s: AppState) => string }
  );

export interface Section {
  id: string;
  title: string;
  controls: Control[];
}

const percent = (n: number) => `${Math.round(n * 100)}%`;
const units = (n: number) => `${n}u`;

const THEMES: Option[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'brand', label: 'Brand' },
  { value: 'paper', label: 'Paper' },
  { value: 'mono', label: 'Mono' },
];

const fontOptions = (ids: Array<keyof typeof FONTS>): Option[] =>
  ids.map((id) => ({ value: id, label: FONTS[id].label }));

const LOCALES: Option[] = [
  { value: 'auto', label: 'Browser language' },
  { value: 'article', label: 'Article language' },
  { value: 'en', label: 'English' },
  { value: 'it', label: 'Italiano' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
  { value: 'pt', label: 'Português' },
];

const isSplit = (s: AppState) => s.style.template === 'split';
const hasImageLayout = (s: AppState) => s.style.template !== 'headline';

export const SECTIONS: Section[] = [
  {
    id: 'content',
    title: 'Content',
    controls: [
      {
        id: 'title',
        label: 'Headline',
        type: 'textarea',
        path: 'article.fields.title',
        rows: 3,
        alternatives: true,
      },
      {
        id: 'description',
        label: 'Subtitle',
        type: 'textarea',
        path: 'article.fields.description',
        rows: 3,
        show: 'style.show.description',
        alternatives: true,
      },
      {
        id: 'kicker',
        label: 'Kicker',
        type: 'text',
        path: 'article.fields.kicker',
        show: 'style.show.kicker',
        alternatives: true,
      },
      {
        id: 'siteName',
        label: 'Outlet name',
        type: 'select',
        path: 'style.show.siteName',
        options: [
          { value: 'auto', label: 'Automatic' },
          { value: true, label: 'Always show' },
          { value: false, label: 'Hide' },
        ],
        help: 'Automatic hides the name next to a wordmark.',
      },
      {
        id: 'siteNameText',
        label: 'Outlet name text',
        type: 'text',
        path: 'article.fields.siteName',
      },
      { id: 'logo', label: 'Logo', type: 'logo' },
      { id: 'image', label: 'Image', type: 'image', visibleIf: hasImageLayout },
      {
        id: 'authors',
        label: 'Authors',
        type: 'authors',
        path: 'article.fields.authors',
        show: 'style.show.authors',
      },
      {
        id: 'published',
        label: 'Published date',
        type: 'date',
        path: 'article.fields.published',
        show: 'style.show.date',
      },
      { id: 'updated', label: 'Show “Updated”', type: 'toggle', path: 'style.show.updated' },
      {
        id: 'accessed',
        label: 'Show “Accessed today”',
        type: 'toggle',
        path: 'style.show.accessed',
      },
      {
        id: 'url',
        label: 'URL',
        type: 'segmented',
        path: 'style.urlStyle',
        show: 'style.show.url',
        options: [
          { value: 'clean', label: 'Clean' },
          { value: 'full', label: 'Full' },
          { value: 'domain', label: 'Domain' },
        ],
      },
      {
        id: 'dateFormat',
        label: 'Date format',
        type: 'select',
        path: 'style.dateFormat',
        options: [
          { value: 'medium', label: 'Nov 6, 2026' },
          { value: 'long', label: 'November 6, 2026' },
          { value: 'short', label: '11/6/26' },
          { value: 'iso', label: '2026-11-06' },
        ],
      },
      {
        id: 'locale',
        label: 'Date language',
        type: 'select',
        path: 'style.locale',
        options: LOCALES,
      },
    ],
  },
  {
    id: 'layout',
    title: 'Layout',
    controls: [
      {
        id: 'template',
        label: 'Template',
        type: 'segmented',
        path: 'style.template',
        options: [
          { value: 'classic', label: 'Classic', icon: 'tpl-classic' },
          { value: 'split', label: 'Split', icon: 'tpl-split' },
          { value: 'headline', label: 'Headline', icon: 'tpl-headline' },
        ],
      },
      { id: 'size', label: 'Size', type: 'size' },
      {
        id: 'width',
        label: 'Width',
        type: 'slider',
        path: 'style.size.width',
        min: 600,
        max: 2000,
        step: 20,
        format: (n) => `${n}px`,
        visibleIf: (s) => s.style.size.preset === 'auto',
      },
      {
        id: 'imagePosition',
        label: 'Image position',
        type: 'segmented',
        path: 'style.imagePosition',
        options: [
          { value: 'start', label: 'Start' },
          { value: 'end', label: 'End' },
        ],
        visibleIf: isSplit,
      },
      {
        id: 'align',
        label: 'Alignment',
        type: 'segmented',
        path: 'style.align',
        options: [
          { value: 'start', label: 'Start' },
          { value: 'center', label: 'Centre' },
        ],
      },
      {
        id: 'density',
        label: 'Density',
        type: 'segmented',
        path: 'style.density',
        options: [
          { value: 'compact', label: 'Compact' },
          { value: 'regular', label: 'Regular' },
          { value: 'airy', label: 'Airy' },
        ],
      },
      {
        id: 'headlineScale',
        label: 'Headline size',
        type: 'slider',
        path: 'style.headlineScale',
        min: 0.8,
        max: 1.25,
        step: 0.05,
        format: percent,
      },
    ],
  },
  {
    id: 'style',
    title: 'Style',
    controls: [
      { id: 'theme', label: 'Theme', type: 'segmented', path: 'style.theme', options: THEMES },
      { id: 'accent', label: 'Accent', type: 'swatches', path: 'style.accent' },
      {
        id: 'headlineFont',
        label: 'Headline font',
        type: 'select',
        path: 'style.fonts.headline',
        options: [
          { value: 'auto', label: 'Automatic' },
          ...fontOptions(['newsreader', 'source-serif', 'inter-tight', 'inter', 'system']),
        ],
      },
      {
        id: 'bodyFont',
        label: 'Body font',
        type: 'select',
        path: 'style.fonts.body',
        options: fontOptions(['inter', 'inter-tight', 'newsreader', 'source-serif', 'system']),
      },
      {
        id: 'radius',
        label: 'Corner radius',
        type: 'slider',
        path: 'style.radius',
        min: 0,
        max: 4,
        step: 0.2,
        format: units,
      },
      {
        id: 'border',
        label: 'Border',
        type: 'segmented',
        path: 'style.border',
        options: [
          { value: 'none', label: 'None' },
          { value: 'hairline', label: 'Hairline' },
        ],
      },
      {
        id: 'logoStyle',
        label: 'Logo style',
        type: 'segmented',
        path: 'style.logoStyle',
        options: [
          { value: 'auto', label: 'Auto' },
          { value: 'original', label: 'Original' },
          { value: 'mono', label: 'Mono' },
        ],
      },
      {
        id: 'imageFilter',
        label: 'Image filter',
        type: 'select',
        path: 'style.imageFilter',
        options: [
          { value: 'none', label: 'None' },
          { value: 'grayscale', label: 'Greyscale' },
          { value: 'dim', label: 'Dim' },
        ],
        visibleIf: hasImageLayout,
      },
    ],
  },
  {
    id: 'frame',
    title: 'Frame',
    controls: [
      {
        id: 'frameEnabled',
        label: 'Frame',
        type: 'toggle',
        path: 'style.frame.enabled',
        help: 'Off gives the bare card with transparent corners, ideal on slides.',
      },
      {
        id: 'frameBackground',
        label: 'Background',
        type: 'select',
        path: 'style.frame.background.kind',
        options: [
          { value: 'transparent', label: 'Transparent' },
          { value: 'solid', label: 'Solid' },
          { value: 'gradient', label: 'Gradient' },
          { value: 'brand', label: 'Brand' },
          { value: 'blur', label: 'Blurred image' },
        ],
        visibleIf: (s) => s.style.frame.enabled,
      },
      {
        id: 'frameGradient',
        label: 'Gradient',
        type: 'select',
        path: 'style.frame.background.value',
        options: ['graphite', 'ink', 'dusk', 'paper', 'sunset', 'aurora', 'ocean', 'mist'].map(
          (v) => ({ value: v, label: v[0]?.toUpperCase() + v.slice(1) }),
        ),
        visibleIf: (s) => s.style.frame.enabled && s.style.frame.background.kind === 'gradient',
      },
      {
        id: 'framePadding',
        label: 'Padding',
        type: 'slider',
        path: 'style.frame.padding',
        min: 0,
        max: 20,
        step: 1,
        format: units,
        visibleIf: (s) => s.style.frame.enabled,
      },
      {
        id: 'frameShadow',
        label: 'Shadow',
        type: 'segmented',
        path: 'style.frame.shadow',
        options: [
          { value: 'none', label: 'None' },
          { value: 'soft', label: 'Soft' },
          { value: 'medium', label: 'Medium' },
          { value: 'strong', label: 'Strong' },
        ],
        visibleIf: (s) => s.style.frame.enabled,
      },
    ],
  },
  {
    id: 'export',
    title: 'Export',
    controls: [
      {
        id: 'format',
        label: 'Format',
        type: 'segmented',
        path: 'style.export.format',
        options: [
          { value: 'png', label: 'PNG' },
          { value: 'jpeg', label: 'JPEG' },
          { value: 'webp', label: 'WebP' },
        ],
      },
      {
        id: 'scale',
        label: 'Scale',
        type: 'segmented',
        path: 'style.export.scale',
        options: [
          { value: 1, label: '1×' },
          { value: 2, label: '2×' },
          { value: 3, label: '3×' },
          { value: 4, label: '4×' },
        ],
      },
      {
        id: 'quality',
        label: 'JPEG quality',
        type: 'slider',
        path: 'style.export.quality',
        min: 0.5,
        max: 1,
        step: 0.01,
        format: percent,
        visibleIf: (s) => s.style.export.format !== 'png',
      },
    ],
  },
];
