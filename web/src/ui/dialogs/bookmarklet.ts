// The bookmarklet install dialog (PLAN.md §11): a link to drag to the bookmarks bar, a "copy code"
// button for browsers where dragging fails, and the three steps in plain words.
import { bookmarkletHref } from '../../bookmarklet/href.ts';
import { h } from '../../render/h.ts';
import type { DialogContent } from './host.ts';

export interface BookmarkletDeps {
  /** This app's own address (no query, no hash); the bookmarklet sends the reader back here. */
  appUrl: string;
  /** Resolves true when the text reached the clipboard. */
  copyText(text: string): Promise<boolean>;
}

export function bookmarkletDialog(deps: BookmarkletDeps): DialogContent {
  const code = bookmarkletHref(deps.appUrl);
  const feedback = h('span', { class: 'dialog-feedback', role: 'status' });

  // The one javascript: URL in the app. It is our own bundle, built at build time; the only value
  // interpolated into it is this page's address. h() refuses such URLs on purpose, so it is set directly.
  const link = h('a', { class: 'bookmarklet-link', draggable: 'true' }, 'Make news card');
  link.setAttribute('href', code);
  link.addEventListener('click', (event) => {
    // Running it here would only read this page: it is meant to be dragged to the bookmarks bar.
    event.preventDefault();
    feedback.textContent = 'Drag it to your bookmarks bar instead of clicking it.';
  });

  const copy = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-secondary btn-sm',
      on: {
        click: () =>
          void deps.copyText(code).then((ok) => {
            feedback.textContent = ok
              ? 'Code copied. Make a new bookmark and paste it as the address.'
              : 'Your browser would not copy it. Drag the button above instead.';
          }),
      },
    },
    'Copy code',
  );

  return {
    title: 'Bookmarklet',
    body: h(
      'div',
      { class: 'dialog-body' },
      h(
        'p',
        { class: 'dialog-note' },
        'Works on any page you can open, including sites that block automated readers or sit behind a paywall. Your browser reads the page, and this app turns it into a card.',
      ),
      h(
        'ol',
        { class: 'steps' },
        h('li', null, 'Drag the button below onto your bookmarks bar.'),
        h('li', null, 'Open the article you want, as you normally would.'),
        h('li', null, 'Click the bookmark. You come back here with the card ready.'),
      ),
      h('div', { class: 'bookmarklet-row' }, link, copy, feedback),
      h(
        'p',
        { class: 'dialog-note' },
        "Only the page's preview details travel back (the tags a link preview reads, its main headings and dates, and its header logo), never the article text. They go inside the address of this page, which no server receives. The app then loads the image and logo through the fetch service, as it does for any link.",
      ),
      h(
        'p',
        { class: 'dialog-note' },
        'Some sites forbid bookmarklets with their security settings (Firefox is the strictest). On those, use Paste page source instead.',
      ),
    ),
  };
}
