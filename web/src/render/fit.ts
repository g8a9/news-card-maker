// Fitting text into fixed-size cards (PLAN.md §7.4). Runs after layout and after fonts have loaded.
//
//  1. Binary-search the headline size between the template's bounds until the text column stops
//     overflowing. The deck is clamped to one line while searching, so the headline gets the room.
//  2. Let the deck grow back to as many lines as fit (up to three).
//  3. If nothing fits at the minimum size, drop optional fields in priority order: subtitle, kicker,
//     author. Never the headline, the masthead, or a date/URL the user switched on.
//  4. Report what happened so the UI can say "Subtitle hidden to fit".
//
// Auto-height cards cannot overflow: the headline gets its default size times the user's scale.

export type HiddenField = 'description' | 'kicker' | 'authors';

export interface FitReport {
  fixed: boolean;
  headlineU: number;
  deckLines: number;
  hidden: HiddenField[];
  /** True when the text column still overflows after everything above. */
  overflow: boolean;
}

const HIDE_CLASS: Record<HiddenField, string> = {
  description: 'nc-hide-deck',
  kicker: 'nc-hide-kicker',
  authors: 'nc-hide-authors',
};

const num = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && value !== undefined && value !== '' ? n : fallback;
};

/** True when the text column's content is taller than the space it was given. */
export function overflows(text: HTMLElement): boolean {
  return text.scrollHeight > text.clientHeight + 1;
}

export function fitCard(card: HTMLElement): FitReport {
  const fixed = card.classList.contains('nc-fixed');
  const text = card.querySelector<HTMLElement>('.nc-text');
  const minU = num(card.dataset.minU, 2.8);
  const maxU = num(card.dataset.maxU, 5.2);
  const autoU = num(card.dataset.autoU, 4.4);

  for (const cls of Object.values(HIDE_CLASS)) card.classList.remove(cls);
  card.style.removeProperty('--deck-lines');

  if (!fixed || !text || !card.isConnected) {
    card.style.setProperty('--hu', String(autoU));
    return { fixed, headlineU: autoU, deckLines: 3, hidden: [], overflow: false };
  }

  const set = (u: number) => card.style.setProperty('--hu', String(Math.round(u * 100) / 100));
  const setDeck = (lines: number) => card.style.setProperty('--deck-lines', String(lines));
  const hasDeck = !!card.querySelector('.nc-deck');
  const hidden: HiddenField[] = [];
  const drop = (field: HiddenField) => {
    card.classList.add(HIDE_CLASS[field]);
    hidden.push(field);
  };

  /** Largest size in [floor, maxU] that fits, or null when even `floor` overflows. */
  const search = (floor: number): number | null => {
    set(maxU);
    if (!overflows(text)) return maxU;
    set(floor);
    if (overflows(text)) return null;
    let lo = floor;
    let hi = maxU;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      set(mid);
      if (overflows(text)) hi = mid;
      else lo = mid;
    }
    return lo;
  };

  // 1. Headline first, with the deck held to a single line.
  if (hasDeck) setDeck(1);
  let headlineU = search(minU);

  // 3. Nothing fits at the minimum size: drop optional fields in priority order, retrying each time.
  if (headlineU === null && hasDeck) {
    drop('description');
    headlineU = search(minU);
  }
  if (headlineU === null && card.querySelector('.nc-kicker')) {
    drop('kicker');
    headlineU = search(minU);
  }
  if (headlineU === null && card.querySelector('.nc-authors')) {
    drop('authors');
    headlineU = search(minU);
  }
  // Last resort before clipping: let the headline go a quarter below its minimum.
  if (headlineU === null) headlineU = search(minU * 0.75) ?? minU * 0.75;
  set(headlineU);

  // 2. Give the deck back as many lines as the leftover space allows.
  let deckLines = 0;
  if (hasDeck && !hidden.includes('description')) {
    deckLines = 1;
    for (const lines of [3, 2]) {
      setDeck(lines);
      if (!overflows(text)) {
        deckLines = lines;
        break;
      }
      setDeck(1);
    }
  }

  return { fixed, headlineU, deckLines, hidden, overflow: overflows(text) };
}

/** Human-readable note for the status line, or null when nothing was hidden. */
export function describeFit(report: FitReport): string | null {
  if (report.hidden.length === 0 && !report.overflow) return null;
  const names: Record<HiddenField, string> = {
    description: 'Subtitle',
    kicker: 'Kicker',
    authors: 'Author',
  };
  const what = report.hidden.map((f) => names[f]).join(', ');
  const tail = 'try Auto height or a taller size';
  if (report.overflow) {
    return `${what ? `${what} hidden, and the` : 'The'} headline is still too long for this size: ${tail}`;
  }
  return `${what} hidden to fit: ${tail}`;
}
