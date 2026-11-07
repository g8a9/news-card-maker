// The editor view (PLAN.md §9.3): top bar, preview stage with its status and action bar, settings panel.
import { type ArticleModel, effective } from '../core/types.ts';
import type { ExportActions } from '../export/actions.ts';
import { h } from '../render/h.ts';
import type { AppState, DialogId } from '../state/app-state.ts';
import type { Store } from '../state/store.ts';
import { icon } from './icons.ts';
import { createMenu } from './menu.ts';
import type { Panel } from './panel.ts';
import type { Stage } from './stage.ts';

export interface EditorDeps {
  stage: Stage;
  panel: Panel;
  actions: ExportActions;
  submit(text: string): void;
  newCard(): void;
  openDialog(id: Exclude<DialogId, null>): void;
  copyLink(): void;
  openOriginal(): void;
}

export interface Editor {
  element: HTMLElement;
  focusUrl(): void;
}

const CAN_COPY = 'ClipboardItem' in window && !!navigator.clipboard?.write;

function hostOf(article: ArticleModel | null): string {
  try {
    return new URL(article?.finalUrl ?? '').hostname.replace(/^www\./, '');
  } catch {
    return 'This site';
  }
}

/** The sentence for a page we could not read (PLAN.md §9.5). */
export function blockedMessage(article: ArticleModel): string {
  const name = effective(article.fields.siteName) ?? hostOf(article);
  switch (article.blockKind) {
    case 'paywall-wall':
      return `${name} requires a subscription, so we couldn't read this page automatically.`;
    case 'geo':
      return `${name} isn't available from our server's region, so we couldn't read this page.`;
    case 'consent-wall':
      return `${name} asks for cookie consent before showing the page, so we couldn't read it.`;
    case 'not-html':
      return "That link doesn't point to a web page we can read.";
    case 'no-metadata':
      return "We couldn't find a headline on this page.";
    default:
      return `${name} didn't let us read this page automatically. That's common with sites that use bot protection.`;
  }
}

export function createEditor(store: Store<AppState>, deps: EditorDeps): Editor {
  // ---- Top bar ----
  const urlInput = h('input', {
    id: 'url-field',
    class: 'input url-input',
    type: 'text',
    inputmode: 'url',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-label': 'Article link',
    placeholder: 'Paste another link…',
  });
  const urlForm = h(
    'form',
    {
      class: 'urlbar',
      novalidate: true,
      on: {
        submit: (e) => {
          e.preventDefault();
          deps.submit(urlInput.value);
        },
      },
    },
    urlInput,
    h(
      'button',
      {
        class: 'icon-btn',
        type: 'submit',
        'aria-label': 'Load this link',
        title: 'Load this link',
      },
      icon('enter', 16),
    ),
  );
  const topbar = h(
    'header',
    { class: 'topbar' },
    h('button', { type: 'button', class: 'brand', on: { click: deps.newCard } }, 'News Card Maker'),
    urlForm,
    h(
      'nav',
      { class: 'top-actions', 'aria-label': 'App' },
      h(
        'button',
        { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: deps.newCard } },
        icon('plus', 14),
        'New',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-ghost btn-sm',
          on: { click: () => deps.openDialog('bookmarklet') },
        },
        icon('bookmark', 14),
        'Bookmarklet',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-label': 'Keyboard shortcuts',
          title: 'Keyboard shortcuts (?)',
          on: { click: () => deps.openDialog('help') },
        },
        icon('help', 16),
      ),
    ),
  );

  // ---- Banner and loading line ----
  const banner = h('div', { class: 'banner-slot' });
  const loadingLine = h('p', { class: 'loading-line', role: 'status', hidden: true });

  const renderBanner = (s: AppState) => {
    const a = s.article;
    if (!a || (a.status === 'ok' && a.blockKind !== 'no-metadata')) return banner.replaceChildren();
    const blocked = a.status === 'blocked' || a.blockKind === 'no-metadata';
    const message = blocked
      ? blockedMessage(a)
      : 'Only some details were found. Check the headline and add an image if needed.';
    const act = (label: string, run: () => void, primary = false) =>
      h(
        'button',
        {
          type: 'button',
          class: primary ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm',
          on: { click: run },
        },
        label,
      );
    const actions = blocked
      ? [
          a.blockKind === 'no-metadata'
            ? act('Fill in manually', () => deps.openDialog('manual'), true)
            : act('Use the bookmarklet', () => deps.openDialog('bookmarklet'), true),
          act('Paste page source', () => deps.openDialog('paste-source')),
          a.blockKind === 'no-metadata'
            ? null
            : act('Fill in manually', () => deps.openDialog('manual')),
        ]
      : [
          act('Use the bookmarklet', () => deps.openDialog('bookmarklet')),
          act('Paste page source', () => deps.openDialog('paste-source')),
          act('Add image', () => deps.panel.focusField('image')),
        ];
    banner.replaceChildren(
      h(
        'div',
        { class: `banner${blocked ? ' banner-blocked' : ''}`, role: 'status' },
        h('p', { class: 'banner-text' }, message),
        h('div', { class: 'banner-actions' }, ...actions),
      ),
    );
  };

  // ---- Action bar ----
  const copyBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-primary',
      id: 'copy-btn',
      on: { click: () => void deps.actions.copy() },
    },
    icon('copy', 16),
    'Copy image',
  );
  const downloadBtn = h(
    'button',
    {
      type: 'button',
      class: CAN_COPY ? 'btn btn-secondary' : 'btn btn-primary',
      id: 'download-btn',
    },
    icon('download', 16),
    'Download',
    icon('chevron-down', 14),
  );
  const downloadMenu = createMenu(downloadBtn, () => [
    { label: 'PNG', run: () => void deps.actions.download('png') },
    { label: 'JPEG', run: () => void deps.actions.download('jpeg') },
    { label: 'WebP', run: () => void deps.actions.download('webp') },
  ]);
  const moreBtn = h(
    'button',
    {
      type: 'button',
      class: 'icon-btn icon-btn-bordered',
      id: 'more-btn',
      'aria-label': 'More actions',
      title: 'More actions',
    },
    icon('more', 16),
  );
  const moreMenu = createMenu(
    moreBtn,
    () => [
      { label: 'Copy link to this card', run: deps.copyLink },
      { label: 'Open original', run: deps.openOriginal },
    ],
    { align: 'end' },
  );
  const readout = h('output', { class: 'px-readout', id: 'px-readout' });
  const actionbar = h(
    'div',
    { class: 'actionbar' },
    CAN_COPY ? copyBtn : null,
    downloadMenu,
    moreMenu,
    readout,
  );

  const stageArea = h(
    'section',
    { class: 'stage-area', 'aria-label': 'Preview' },
    banner,
    loadingLine,
    deps.stage.element,
    actionbar,
  );
  const element = h(
    'div',
    { class: 'editor' },
    topbar,
    h('main', { class: 'workspace' }, stageArea, deps.panel.element),
  );

  store.subscribe(
    (s) => s,
    (s) => {
      renderBanner(s);
      const a = s.article;
      const shown = a ? a.citeUrl : s.input.url;
      if (document.activeElement !== urlInput && urlInput.value !== shown) urlInput.value = shown;

      loadingLine.hidden = !s.loading;
      if (s.loading)
        loadingLine.textContent = s.loading.slow
          ? 'Still trying: some sites are slow'
          : `Reading ${s.loading.host}…`;

      const ready = !!a && s.phase === 'editing';
      copyBtn.disabled = !ready;
      downloadBtn.disabled = !ready;
      moreBtn.disabled = !ready;
      const m = s.ui.measured;
      readout.textContent =
        ready && m
          ? `${Math.round(m.width * s.style.export.scale)} × ${Math.round(m.height * s.style.export.scale)} px`
          : '';
    },
    { equals: () => false, immediate: true },
  );

  return {
    element,
    focusUrl: () => {
      urlInput.focus();
      urlInput.select();
    },
  };
}
