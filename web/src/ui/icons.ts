// About a dozen inline icons (Lucide, MIT licence), built as SVG elements: no icon font, no markup strings.
import { svg } from '../render/h.ts';

type Shape = [string, Record<string, string | number>];

const ICONS = {
  copy: [
    ['rect', { width: 14, height: 14, x: 8, y: 8, rx: 2, ry: 2 }],
    ['path', { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' }],
  ],
  download: [
    ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
    ['polyline', { points: '7 10 12 15 17 10' }],
    ['line', { x1: 12, x2: 12, y1: 15, y2: 3 }],
  ],
  'chevron-down': [['path', { d: 'm6 9 6 6 6-6' }]],
  'chevron-right': [['path', { d: 'm9 18 6-6-6-6' }]],
  more: [
    ['circle', { cx: 12, cy: 12, r: 1 }],
    ['circle', { cx: 19, cy: 12, r: 1 }],
    ['circle', { cx: 5, cy: 12, r: 1 }],
  ],
  help: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['path', { d: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' }],
    ['path', { d: 'M12 17h.01' }],
  ],
  bookmark: [['path', { d: 'm19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z' }]],
  plus: [
    ['path', { d: 'M5 12h14' }],
    ['path', { d: 'M12 5v14' }],
  ],
  x: [
    ['path', { d: 'M18 6 6 18' }],
    ['path', { d: 'm6 6 12 12' }],
  ],
  upload: [
    ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
    ['polyline', { points: '17 8 12 3 7 8' }],
    ['line', { x1: 12, x2: 12, y1: 3, y2: 15 }],
  ],
  image: [
    ['rect', { width: 18, height: 18, x: 3, y: 3, rx: 2, ry: 2 }],
    ['circle', { cx: 9, cy: 9, r: 2 }],
    ['path', { d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' }],
  ],
  link: [
    ['path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }],
    ['path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }],
  ],
  external: [
    ['path', { d: 'M15 3h6v6' }],
    ['path', { d: 'M10 14 21 3' }],
    ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }],
  ],
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
  enter: [
    ['polyline', { points: '9 10 4 15 9 20' }],
    ['path', { d: 'M20 4v7a4 4 0 0 1-4 4H4' }],
  ],
  reset: [
    ['path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }],
    ['path', { d: 'M3 3v5h5' }],
  ],
  github: [
    [
      'path',
      {
        d: 'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4',
      },
    ],
    ['path', { d: 'M9 18c-4.51 2-5-2-7-2' }],
  ],
  // Layout thumbnails for the template picker.
  'tpl-classic': [
    ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }],
    ['rect', { x: 3, y: 3, width: 18, height: 8, rx: 2 }],
    ['path', { d: 'M7 15h10M7 18h6' }],
  ],
  'tpl-split': [
    ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }],
    ['path', { d: 'M14 3v18' }],
    ['path', { d: 'M6 9h5M6 12h5M6 15h3' }],
  ],
  'tpl-headline': [
    ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }],
    ['path', { d: 'M7 9h10M7 13h10M7 17h6' }],
  ],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 16): SVGElement {
  const root = svg('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  for (const [tag, attrs] of ICONS[name] as Shape[]) root.append(svg(tag, attrs));
  return root;
}
