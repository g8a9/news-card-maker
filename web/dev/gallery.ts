// Dev gallery (PLAN.md §13.4): every template × theme × size, rendered from synthetic fixtures with
// the real renderer and the real fitter. Also the target of visual and export tests:
//
//   /dev/gallery.html                                  the whole matrix, with an overflow report
//   /dev/gallery.html?fixture=cjk&template=split&theme=dark&size=16:9     one card at full size
//
// Playwright reads `window.__gallery` once `ready` resolves.

import type { ArticleModel } from '../src/core/types.ts';
import { prepareAssets } from '../src/render/assets.ts';
import { renderCard } from '../src/render/card.ts';
import { type FitReport, fitCard } from '../src/render/fit.ts';
import { loadCardFonts } from '../src/render/fonts.ts';
import {
  type CardStyle,
  defaultStyle,
  type SizePreset,
  type TemplateId,
  type ThemeId,
} from '../src/render/style.ts';
import { makeArticle, SPECS } from './synthetic.ts';

const TEMPLATES: TemplateId[] = ['classic', 'split', 'headline'];
const THEMES: ThemeId[] = ['light', 'dark', 'brand', 'paper', 'mono'];
const SIZES: SizePreset[] = ['auto', '16:9', '4:3', '3:2', '1.91:1', '2:1', '1:1', '4:5', '9:16'];
const EDGE_SIZES: SizePreset[] = ['auto', '16:9', '1:1', '9:16'];
const NOW = new Date(Date.UTC(2026, 10, 7, 12));

export interface CardReport {
  id: string;
  fixture: string;
  template: TemplateId;
  theme: ThemeId;
  size: SizePreset;
  width: number;
  height: number;
  fit: FitReport;
  /** Text blocks that stick out of the card's own box. */
  escapes: string[];
}

const params = new URLSearchParams(location.search);
const main = document.getElementById('main') as HTMLElement;
const summary = document.getElementById('summary') as HTMLElement;

function styleFor(template: TemplateId, theme: ThemeId, size: SizePreset): CardStyle {
  const style = defaultStyle();
  style.template = template;
  style.theme = theme;
  style.size = { preset: size, width: 1200, height: null };
  style.show.kicker = true;
  style.show.authors = true;
  return style;
}

/** Elements whose box leaves the card's box: something the fitter should have prevented. */
function findEscapes(card: HTMLElement): string[] {
  const box = card.getBoundingClientRect();
  const escapes: string[] = [];
  for (const el of card.querySelectorAll<HTMLElement>(
    '.nc-headline, .nc-deck, .nc-kicker, .nc-meta, .nc-masthead, .nc-site, .nc-text',
  )) {
    if (el.offsetParent === null && getComputedStyle(el).display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const tolerance = 1.5;
    if (
      r.left < box.left - tolerance ||
      r.right > box.right + tolerance ||
      r.top < box.top - tolerance ||
      r.bottom > box.bottom + tolerance
    ) {
      escapes.push(el.className.split(' ')[0] ?? el.tagName);
    }
  }
  // A headline taller than its column is clipped by overflow: hidden, so also compare scroll sizes.
  const text = card.querySelector<HTMLElement>('.nc-text');
  if (text && text.scrollHeight > text.clientHeight + 1) escapes.push('nc-text(clipped)');
  const headline = card.querySelector<HTMLElement>('.nc-headline');
  if (headline && headline.scrollWidth > headline.clientWidth + 1)
    escapes.push('nc-headline(wide)');
  return escapes;
}

async function mountCard(
  host: HTMLElement,
  article: ArticleModel,
  style: CardStyle,
  scale: number,
  meta: { fixture: string },
): Promise<CardReport> {
  const assets = await prepareAssets(article, style);
  const rendered = renderCard({ article, style, assets, hostLocale: 'en', now: NOW });
  const scaler = document.createElement('div');
  scaler.className = 'scaler';
  scaler.style.transform = `scale(${scale})`;
  scaler.append(rendered.root);
  const cell = document.createElement('div');
  cell.className = 'cell';
  cell.append(scaler);
  host.append(cell);
  await loadCardFonts(rendered.fonts, rendered.text);
  const fit = fitCard(rendered.card);
  const w = rendered.root.offsetWidth;
  const h = rendered.root.offsetHeight;
  cell.style.width = `${w * scale}px`;
  cell.style.height = `${h * scale}px`;
  return {
    id: `${meta.fixture}/${style.template}/${style.theme}/${style.size.preset}`,
    fixture: meta.fixture,
    template: style.template,
    theme: style.theme,
    size: style.size.preset,
    width: w,
    height: h,
    fit,
    escapes: findEscapes(rendered.card),
  };
}

function caption(fig: HTMLElement, report: CardReport): void {
  fig.dataset.id = report.id;
  const cap = document.createElement('figcaption');
  const bad = report.escapes.length > 0 || report.fit.overflow;
  cap.className = bad ? 'bad' : '';
  const hidden = report.fit.hidden.length ? ` · hid ${report.fit.hidden.join('+')}` : '';
  cap.textContent = `${report.template} · ${report.theme} · ${report.size} · ${report.width}×${report.height}${hidden}${bad ? ` · OVERFLOW ${report.escapes.join(',')}` : ''}`;
  fig.append(cap);
}

async function run(): Promise<CardReport[]> {
  const articles = new Map<string, ArticleModel>();
  for (const spec of SPECS) articles.set(spec.id, await makeArticle(spec));

  // Single-card mode: one card at 100% for visual and export tests.
  if (params.has('fixture')) {
    const article = articles.get(params.get('fixture') as string) as ArticleModel;
    const style = styleFor(
      (params.get('template') ?? 'classic') as TemplateId,
      (params.get('theme') ?? 'light') as ThemeId,
      (params.get('size') ?? 'auto') as SizePreset,
    );
    if (style.size.preset === 'custom') {
      style.size = {
        preset: 'custom',
        width: Number(params.get('w') ?? 1200),
        height: Number(params.get('h') ?? 675),
      };
    }
    if (params.get('frame') === '1') {
      style.frame.enabled = true;
      const bg = params.get('frameBg');
      if (bg === 'blur') style.frame.background = { kind: 'blur' };
      else if (bg === 'gradient') style.frame.background = { kind: 'gradient', value: 'sunset' };
      else if (bg === 'transparent') style.frame.background = { kind: 'transparent' };
    }
    if (params.get('kicker') === '0') style.show.kicker = false;
    const host = document.createElement('div');
    host.id = 'single';
    main.replaceChildren(host);
    const report = await mountCard(host, article, style, Number(params.get('scale') ?? 1), {
      fixture: params.get('fixture') as string,
    });
    summary.textContent = `${report.id}: ${report.width}×${report.height}`;
    if (params.get('export') === '1') {
      const { renderToBlob } = await import('../src/export/capture.ts');
      const target = () =>
        (document.querySelector('.nc-frame') ?? document.querySelector('.nc-card')) as HTMLElement;
      const toDataUrl = (blob: Blob) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      (window as unknown as { __export: unknown }).__export = {
        png: async (scale: number) =>
          toDataUrl(await renderToBlob(target(), { scale, type: 'image/png' })),
      };
    }
    if (params.get('spike') === '1') {
      document.body.style.background = '#808080'; // the grey the spike composites transparent pixels on
      document.querySelector('header.bar')?.remove(); // a sticky header would overlap the reference screenshot
      main.style.padding = '0';
      window.scrollTo(0, 0);
      (await import('./spike.ts')).installSpike();
    }
    return [report];
  }

  const reports: CardReport[] = [];
  const section = (title: string): HTMLElement => {
    const h2 = document.createElement('h2');
    h2.textContent = title;
    const grid = document.createElement('div');
    grid.className = 'grid';
    main.append(h2, grid);
    return grid;
  };

  const scaleFor = (width: number) => Math.min(1, 300 / width);

  // 1. The whole matrix with the standard fixture.
  const standard = articles.get('standard') as ArticleModel;
  for (const template of TEMPLATES) {
    for (const theme of THEMES) {
      const grid = section(`standard · ${template} · ${theme}`);
      for (const size of SIZES) {
        const style = styleFor(template, theme, size);
        const slot = document.createElement('figure');
        grid.append(slot); // attached first: fitting measures real layout
        const report = await mountCard(slot, standard, style, scaleFor(1200), {
          fixture: 'standard',
        });
        reports.push(report);
        caption(slot, report);
      }
    }
  }

  // 2. Edge cases: every other fixture, light and dark, a few sizes.
  for (const spec of SPECS) {
    if (spec.id === 'standard') continue;
    const article = articles.get(spec.id) as ArticleModel;
    for (const template of TEMPLATES) {
      const grid = section(`${spec.id} · ${template}`);
      for (const theme of ['light', 'dark'] as ThemeId[]) {
        for (const size of EDGE_SIZES) {
          const style = styleFor(template, theme, size);
          const slot = document.createElement('figure');
          grid.append(slot);
          const report = await mountCard(slot, article, style, scaleFor(1200), {
            fixture: spec.id,
          });
          reports.push(report);
          caption(slot, report);
        }
      }
    }
  }

  const bad = reports.filter((r) => r.escapes.length > 0 || r.fit.overflow);
  const hid = reports.filter((r) => r.fit.hidden.length > 0).length;
  summary.textContent = `${reports.length} cards · ${bad.length} overflowing · ${hid} had optional fields hidden to fit`;
  summary.classList.toggle('bad', bad.length > 0);
  return reports;
}

declare global {
  interface Window {
    __gallery: { ready: Promise<CardReport[]> };
  }
}
window.__gallery = { ready: run() };
