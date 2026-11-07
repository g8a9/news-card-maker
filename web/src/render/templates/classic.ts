// Classic: image full-bleed at the top, then masthead, kicker, headline, deck, rule and meta (§7.2).
import { h } from '../h.ts';
import type { Template } from './types.ts';

export const classic: Template = {
  id: 'classic',
  headline: { autoU: 4.4, minU: 2.8, maxU: 5.2 },
  build({ card, parts, size, orientation, hasImage }) {
    // Auto height: a 1.91:1 image. Fixed sizes: roughly half the height (landscape) or 45% (square),
    // a little less for very wide-and-short sizes (1.91:1, 2:1) so the text still has room.
    const ratio = size.height === null ? 0 : size.width / size.height;
    const fraction =
      orientation === 'portrait'
        ? 0.4
        : orientation === 'square'
          ? 0.45
          : ratio >= 1.8
            ? 0.4
            : 0.46;
    const mediaHeight = size.height === null ? size.width / 1.91 : size.height * fraction;
    card.style.setProperty('--media-h', `${mediaHeight}px`);

    card.append(
      hasImage && parts.media ? parts.media : h('div', { class: 'nc-top-bar' }),
      h(
        'div',
        { class: 'nc-body' },
        parts.masthead,
        h('div', { class: 'nc-text' }, parts.kicker, parts.headline, parts.deck),
        parts.meta ? h('div', { class: 'nc-rule' }) : null,
        parts.meta,
      ),
    );
  },
};
