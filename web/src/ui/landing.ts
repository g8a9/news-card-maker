// The landing page (PLAN.md §9.2): one text box, three real examples, and the escape hatches.
import { REPO_URL } from '../config.ts';
import { normalizeInput } from '../core/url.ts';
import { h } from '../render/h.ts';
import type { AppState } from '../state/app-state.ts';
import type { Store } from '../state/store.ts';
import { icon } from './icons.ts';

/** Real, stable article pages (checked against the live pipeline). Never fabricated samples. */
export const EXAMPLES: Array<{ label: string; url: string }> = [
  { label: 'Hacker News', url: 'https://news.ycombinator.com/item?id=8863' },
  { label: '404 Media', url: 'https://www.404media.co/behind-the-blog-dams-bursting/' },
  {
    label: 'Corriere della Sera',
    url: 'https://www.corriere.it/dataroom-milena-gabanelli/codice-strada-ecco-cosa-cambia-perche-non-ridurra-numero-vittime/a9ec82f6-0fb3-11ef-a8f0-a1f7c0d711f2-va.shtml',
  },
];

export interface LandingHandlers {
  submit(text: string): void;
  openDialog(id: 'bookmarklet' | 'paste-source' | 'manual'): void;
}

export function createLanding(store: Store<AppState>, on: LandingHandlers): HTMLElement {
  const input = h('input', {
    id: 'landing-url',
    class: 'input landing-input',
    type: 'text',
    inputmode: 'url',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: 'Paste a news article link…',
    'aria-label': 'News article link',
    'aria-describedby': 'landing-error',
    autofocus: true,
  });
  const create = h(
    'button',
    { class: 'btn btn-primary landing-create', type: 'submit', disabled: true },
    'Create ',
    icon('enter', 14),
  );
  const error = h('p', { id: 'landing-error', class: 'landing-error', role: 'alert' });

  const refresh = () => {
    create.disabled = !normalizeInput(input.value).ok;
  };
  input.addEventListener('input', () => {
    refresh();
    // Typing again dismisses the previous message.
    if (store.get().inputError)
      store.set((s) => (s.inputError ? { ...s, inputError: null, failure: null } : s));
  });
  // The button is disabled until the text looks like a link, which also blocks Enter. Enter should
  // still answer, with the inline message, so submit explicitly.
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && create.disabled) {
      event.preventDefault();
      on.submit(input.value);
    }
  });

  const form = h(
    'form',
    {
      class: 'landing-form',
      novalidate: true,
      on: {
        submit: (e) => {
          e.preventDefault();
          on.submit(input.value);
        },
      },
    },
    input,
    create,
  );

  const chips = h(
    'div',
    { class: 'landing-chips' },
    h('span', { class: 'landing-try' }, 'Try:'),
    ...EXAMPLES.map((ex) =>
      h(
        'button',
        { class: 'chip', type: 'button', on: { click: () => on.submit(ex.url) } },
        ex.label,
      ),
    ),
  );

  const link = (label: string, id: 'bookmarklet' | 'paste-source' | 'manual') =>
    h(
      'button',
      { class: 'link-btn', type: 'button', on: { click: () => on.openDialog(id) } },
      label,
    );

  const root = h(
    'section',
    { class: 'landing', 'aria-labelledby': 'landing-title' },
    h(
      'div',
      { class: 'landing-column' },
      h('h1', { id: 'landing-title', class: 'landing-title' }, 'News Card Maker'),
      h(
        'p',
        { class: 'landing-tagline' },
        'Turn a news link into a clean, citable card for your slides.',
      ),
      form,
      error,
      chips,
      h(
        'p',
        { class: 'landing-alt' },
        link('Use the bookmarklet', 'bookmarklet'),
        ' · ',
        link('Paste page source', 'paste-source'),
        ' · ',
        link('Start from scratch', 'manual'),
      ),
    ),
    h(
      'footer',
      { class: 'landing-footer' },
      h('span', null, 'Open source · No tracking · Logos and headlines belong to their publishers'),
      // Only when the build knows the repository (VITE_REPO_URL): there is no place to link to otherwise.
      REPO_URL
        ? h(
            'a',
            {
              class: 'icon-link',
              href: REPO_URL,
              'aria-label': 'Source code on GitHub',
              rel: 'noopener',
              target: '_blank',
            },
            icon('github', 16),
          )
        : null,
    ),
  );

  store.subscribe(
    (s) => [s.inputError, s.input.url],
    ([message, url]) => {
      error.textContent = (message as string | null) ?? '';
      if (typeof url === 'string' && url !== input.value && document.activeElement !== input)
        input.value = url;
      refresh();
    },
    { immediate: true, equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  );
  return root;
}

export const focusLanding = (root: ParentNode): void =>
  root.querySelector<HTMLInputElement>('#landing-url')?.focus();
