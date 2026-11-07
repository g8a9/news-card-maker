// Split: text column beside a full-height image on the end side (§7.2). Landscape first; portrait
// sizes fall back to the Classic structure (decided in card.ts).
import { h } from '../h.ts';
import type { Template } from './types.ts';

export const split: Template = {
  id: 'split',
  headline: { autoU: 4.2, minU: 2.6, maxU: 5 },
  build({ card, parts, hasImage }) {
    const body = h(
      'div',
      { class: 'nc-body' },
      parts.masthead,
      h('div', { class: 'nc-text' }, parts.kicker, parts.headline, parts.deck),
      parts.meta ? h('div', { class: 'nc-rule' }) : null,
      parts.meta,
    );
    card.append(body);
    if (hasImage && parts.media) card.append(parts.media);
  },
};
