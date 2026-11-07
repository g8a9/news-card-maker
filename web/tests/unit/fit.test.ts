import { afterEach, describe, expect, it } from 'vitest';
import { renderCard } from '../../src/render/card.ts';
import { describeFit, type FitReport, fitCard, overflows } from '../../src/render/fit.ts';
import { type CardStyle, defaultStyle } from '../../src/render/style.ts';
import { makeModel } from './card-helpers.ts';

// jsdom has no layout engine, so the text column's scrollHeight is simulated from the card's own
// state: the headline size (--hu), the deck line clamp, and which optional fields are hidden.
const LINE_H = 1.12;
const mounted: HTMLElement[] = [];
afterEach(() => {
  for (const el of mounted.splice(0)) el.remove();
});

function build(opts: {
  available: number;
  headlineLines?: (u: number) => number;
  mutate?: (s: CardStyle) => void;
  model?: ReturnType<typeof makeModel>;
}) {
  const style = defaultStyle();
  style.size = { preset: '16:9', width: 1200, height: 675 };
  style.show.kicker = true;
  style.show.authors = true;
  opts.mutate?.(style);
  const { card } = renderCard({ article: opts.model ?? makeModel(), style, hostLocale: 'en' });
  document.body.append(card);
  mounted.push(card);
  const text = card.querySelector('.nc-text') as HTMLElement;
  const lines = opts.headlineLines ?? ((u) => Math.ceil((u * 12 * 40) / 1000)); // wider type wraps more
  Object.defineProperty(text, 'clientHeight', { configurable: true, get: () => opts.available });
  Object.defineProperty(text, 'scrollHeight', {
    configurable: true,
    get: () => {
      const u = Number(card.style.getPropertyValue('--hu'));
      const deckLines = Number(card.style.getPropertyValue('--deck-lines') || 3);
      let h = u * 12 * LINE_H * lines(u);
      if (card.querySelector('.nc-deck') && !card.classList.contains('nc-hide-deck'))
        h += 16 + deckLines * 29;
      if (card.querySelector('.nc-kicker') && !card.classList.contains('nc-hide-kicker'))
        h += 16 + 18;
      return h;
    },
  });
  return { card, text };
}

describe('fitCard (PLAN.md §7.4)', () => {
  it('uses the maximum headline size and a three-line deck when there is room', () => {
    const { card } = build({ available: 1000 });
    const report = fitCard(card);
    expect(report).toMatchObject({ fixed: true, hidden: [], overflow: false, deckLines: 3 });
    expect(report.headlineU).toBeCloseTo(Number(card.dataset.maxU), 5);
    expect(card.style.getPropertyValue('--hu')).toBe(
      String(Math.round(Number(card.dataset.maxU) * 100) / 100),
    );
  });

  it('finds the largest headline that fits, between the bounds', () => {
    const { card, text } = build({ available: 190, headlineLines: () => 2 });
    const report = fitCard(card);
    expect(report.overflow).toBe(false);
    expect(report.headlineU).toBeGreaterThan(Number(card.dataset.minU));
    expect(report.headlineU).toBeLessThan(Number(card.dataset.maxU));
    expect(overflows(text)).toBe(false);
    // and it is close to the limit: a slightly bigger headline would overflow
    const bigger = report.headlineU + 0.15;
    card.style.setProperty('--hu', String(bigger));
    card.style.setProperty('--deck-lines', '1');
    expect(overflows(text)).toBe(true);
  });

  it('gives the deck back the lines that fit', () => {
    const roomy = build({
      available: 400,
      headlineLines: () => 1,
      mutate: (s) => (s.show.kicker = false),
    });
    expect(fitCard(roomy.card).deckLines).toBe(3);
    // available is tuned so a three-line deck does not fit but two do
    const medium = build({
      available: 150,
      headlineLines: () => 1,
      mutate: (s) => (s.show.kicker = false),
    });
    const report = fitCard(medium.card);
    expect(report.hidden).toEqual([]);
    expect(report.deckLines).toBeGreaterThanOrEqual(1);
    expect(report.deckLines).toBeLessThan(3);
    expect(overflows(medium.text)).toBe(false);
  });

  it('drops the subtitle, then the kicker, then the author, in that order', () => {
    const lines = () => 3;
    const subtitle = build({ available: 160, headlineLines: lines });
    const kicker = build({ available: 130, headlineLines: lines });
    const author = build({ available: 82, headlineLines: lines });
    expect(fitCard(subtitle.card).hidden).toEqual(['description']);
    expect(fitCard(kicker.card).hidden).toEqual(['description', 'kicker']);
    const a = fitCard(author.card);
    expect(a.hidden.slice(0, 2)).toEqual(['description', 'kicker']);
    expect(a.deckLines).toBe(0);
  });

  it('never drops the headline: it reports overflow when nothing else helps', () => {
    const { card } = build({ available: 30, headlineLines: () => 3 });
    const report = fitCard(card);
    expect(report.overflow).toBe(true);
    expect(report.headlineU).toBeCloseTo(Number(card.dataset.minU) * 0.75, 5);
    expect(card.querySelector('.nc-headline')).not.toBeNull();
    expect(report.hidden).toEqual(expect.arrayContaining(['description', 'kicker']));
  });

  it('is repeatable: fitting again starts from a clean slate', () => {
    const { card, text } = build({ available: 105, headlineLines: () => 3 });
    const first = fitCard(card);
    expect(first.hidden.length).toBeGreaterThan(0);
    Object.defineProperty(text, 'clientHeight', { configurable: true, get: () => 1000 });
    const second = fitCard(card);
    expect(second.hidden).toEqual([]);
    expect(card.classList.contains('nc-hide-deck')).toBe(false);
    expect(second.deckLines).toBe(3);
  });

  it('does nothing to auto-height cards beyond setting the default size', () => {
    const style = defaultStyle();
    const { card } = renderCard({ article: makeModel(), style, hostLocale: 'en' });
    document.body.append(card);
    mounted.push(card);
    const report = fitCard(card);
    expect(report).toMatchObject({ fixed: false, hidden: [], overflow: false });
    expect(report.headlineU).toBeCloseTo(4.4, 5);
  });

  it('does nothing to cards that are not in the document', () => {
    const style = defaultStyle();
    style.size = { preset: '16:9', width: 1200, height: 675 };
    const { card } = renderCard({ article: makeModel(), style, hostLocale: 'en' });
    expect(fitCard(card)).toMatchObject({ hidden: [], overflow: false });
  });

  it('handles cards without a deck, kicker or authors', () => {
    const { card } = build({
      available: 90,
      headlineLines: () => 2,
      model: makeModel({ description: null, kicker: null, authors: null }),
    });
    const report = fitCard(card);
    expect(report.deckLines).toBe(0);
    expect(report.hidden).toEqual([]);
  });
});

describe('describeFit', () => {
  const report = (over: Partial<FitReport>): FitReport => ({
    fixed: true,
    headlineU: 3,
    deckLines: 0,
    hidden: [],
    overflow: false,
    ...over,
  });

  it('says nothing when nothing happened', () => {
    expect(describeFit(report({}))).toBeNull();
  });

  it('names what was hidden and offers the way out', () => {
    expect(describeFit(report({ hidden: ['description'] }))).toBe(
      'Subtitle hidden to fit: try Auto height or a taller size',
    );
    expect(describeFit(report({ hidden: ['description', 'kicker'] }))).toBe(
      'Subtitle, Kicker hidden to fit: try Auto height or a taller size',
    );
  });

  it('is honest when the headline itself does not fit', () => {
    expect(describeFit(report({ overflow: true }))).toContain('headline is still too long');
    expect(describeFit(report({ overflow: true, hidden: ['description'] }))).toContain(
      'Subtitle hidden, and the headline',
    );
  });
});
