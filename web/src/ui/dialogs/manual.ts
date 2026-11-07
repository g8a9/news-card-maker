// Start from scratch (PLAN.md §9.2, §9.5): type the headline, pick an outlet from the registry (or name
// one) and add an optional link and date. Also the way out for pages with no headline to find, where
// it opens prefilled with whatever was found.
import type { ManualInput } from '../../core/manual.ts';
import type { Outlet } from '../../core/registry.ts';
import { normalizeInput } from '../../core/url.ts';
import { h } from '../../render/h.ts';
import type { DialogContent } from './host.ts';

export interface ManualDeps {
  outlets: readonly Outlet[];
  prefill: {
    title?: string;
    description?: string;
    siteName?: string;
    outletId?: string;
    url?: string;
    /** yyyy-mm-dd */
    date?: string;
  };
  submit(input: ManualInput): void;
}

export function manualDialog(deps: ManualDeps): DialogContent {
  const { prefill } = deps;
  const sorted = [...deps.outlets].sort((a, b) => a.name.localeCompare(b.name));

  const outlet = h(
    'select',
    { id: 'manual-outlet', class: 'select' },
    h('option', { value: '' }, 'Other outlet'),
    ...sorted.map((o) => h('option', { value: o.id }, o.name)),
  );
  outlet.value = sorted.some((o) => o.id === prefill.outletId) ? (prefill.outletId ?? '') : '';
  const siteName = h('input', {
    id: 'manual-site',
    class: 'input',
    type: 'text',
    autocomplete: 'off',
    placeholder: 'Outlet name',
    'aria-label': 'Outlet name',
    value: prefill.siteName ?? '',
  });
  const title = h('textarea', {
    id: 'manual-title',
    class: 'input',
    rows: 3,
    maxlength: 400,
    autofocus: true,
    placeholder: 'The headline',
  });
  title.value = prefill.title ?? '';
  const description = h('textarea', {
    id: 'manual-description',
    class: 'input',
    rows: 2,
    maxlength: 600,
    placeholder: 'Optional',
  });
  description.value = prefill.description ?? '';
  const date = h('input', {
    id: 'manual-date',
    class: 'input',
    type: 'date',
    value: prefill.date ?? '',
  });
  const url = h('input', {
    id: 'manual-url',
    class: 'input',
    type: 'text',
    inputmode: 'url',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'https://… (printed on the card)',
    value: prefill.url ?? '',
  });
  const error = h('p', { class: 'dialog-error', role: 'alert' });

  const syncName = () => {
    siteName.hidden = outlet.value !== '';
  };
  outlet.addEventListener('change', syncName);
  syncName();

  const field = (label: string, id: string, ...controls: HTMLElement[]) =>
    h(
      'div',
      { class: 'form-field' },
      h('label', { class: 'form-label', for: id }, label),
      ...controls,
    );

  const submit = () => {
    const headline = title.value.trim();
    if (!headline) {
      error.textContent = 'Add a headline.';
      return title.focus();
    }
    let link = '';
    if (url.value.trim()) {
      const parsed = normalizeInput(url.value);
      if (!parsed.ok) {
        error.textContent = 'Enter the link starting with https://, or leave it empty.';
        return url.focus();
      }
      link = parsed.url;
    }
    deps.submit({
      title: headline,
      description: description.value.trim() || undefined,
      outletId: outlet.value || null,
      siteName: outlet.value ? undefined : siteName.value.trim() || undefined,
      url: link || undefined,
      date: date.value || undefined,
    });
  };

  title.addEventListener('input', () => {
    error.textContent = '';
  });

  return {
    title: 'Start from scratch',
    body: h(
      'form',
      {
        class: 'dialog-body',
        novalidate: true,
        on: {
          submit: (event) => {
            event.preventDefault();
            submit();
          },
        },
      },
      h(
        'p',
        { class: 'dialog-note' },
        'Type the details yourself. Pick an outlet from the list to get its logo and colours.',
      ),
      field('Outlet', 'manual-outlet', outlet, siteName),
      field('Headline', 'manual-title', title),
      field('Subtitle', 'manual-description', description),
      h(
        'div',
        { class: 'form-row' },
        field('Date', 'manual-date', date),
        field('Link', 'manual-url', url),
      ),
      error,
      h(
        'div',
        { class: 'dialog-actions' },
        h('button', { type: 'submit', class: 'btn btn-primary' }, 'Create card'),
      ),
    ),
  };
}
