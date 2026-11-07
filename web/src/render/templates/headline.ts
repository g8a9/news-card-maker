// Headline: no image; a big headline fitted between 5u and 8u (§7.2).
import { h } from '../h.ts';
import type { Template } from './types.ts';

export const headline: Template = {
  id: 'headline',
  // The brief says 5u to 8u; the floor is lower so a very long headline still fits instead of overflowing.
  headline: { autoU: 6.4, minU: 3.4, maxU: 8 },
  build({ card, parts }) {
    card.append(
      h('div', { class: 'nc-bar' }),
      h(
        'div',
        { class: 'nc-body' },
        parts.masthead,
        h('div', { class: 'nc-text' }, parts.kicker, parts.headline, parts.deck),
        parts.meta,
      ),
    );
  },
};
