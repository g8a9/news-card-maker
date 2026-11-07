// The app: wires the store, the pipeline, the two views (landing and editor), shortcuts and dialogs.
import { findOutletById, type Outlet } from '../core/registry.ts';
import { type ArticleModel, effective, type Field } from '../core/types.ts';
import { normalizeInput } from '../core/url.ts';
import { createExportActions } from '../export/actions.ts';
import {
  loadImage,
  loadImageFromBlob,
  loadLogo,
  loadLogoFromBlob,
  revokeLoaded,
} from '../net/images.ts';
import { PipelineError, type PipelineEvent, resolveArticle } from '../net/pipeline.ts';
import {
  type AppState,
  type DialogId,
  type InputSource,
  initialState,
} from '../state/app-state.ts';
import { styleForNewCard } from '../state/defaults.ts';
import { setOverride, withField } from '../state/fields.ts';
import { setPath } from '../state/paths.ts';
import { createStore, type Store } from '../state/store.ts';
import type { PanelDeps } from './controls/build.ts';
import { helpDialog } from './dialogs/help.ts';
import { createDialogHost } from './dialogs/host.ts';
import { createEditor, type Editor } from './editor.ts';
import { createLanding, focusLanding } from './landing.ts';
import { createPanel, type Panel } from './panel.ts';
import { installShortcuts } from './shortcuts.ts';
import { createStage, type Stage } from './stage.ts';
import { createToasts, pushToast } from './toasts.ts';

export interface AppDeps {
  proxyUrl: string;
  outlets: readonly Outlet[];
  hostLocale: string;
  /** Replaceable in tests. */
  resolve?: typeof resolveArticle;
}

export interface App {
  store: Store<AppState>;
  stage: Stage;
  panel: Panel;
  editor: Editor;
  start(): void;
  submit(text: string, source?: InputSource): Promise<void>;
  newCard(): void;
}

const MESSAGES = {
  invalid: 'Paste a full link, starting with https://',
  proxy: 'The fetch service is unavailable. Try again in a minute, or paste the page source.',
  rate: 'Too many requests right now. Try again in a minute.',
  fetch: "We couldn't read that page. Try the bookmarklet, or paste the page source.",
  hn: "Hacker News didn't answer. Try again in a minute.",
  unknown: 'Something went wrong while reading that page. Try again, or paste the page source.',
} as const;

function noticesFor(model: ArticleModel): string[] {
  const notes: string[] = [];
  if (model.provenance.includes('bookmarklet')) notes.push('Read from the page you were viewing');
  if (model.provenance.includes('paste')) notes.push('Read from the page source you pasted');
  return notes;
}

/** Keeps what the user has chosen or typed while images and logos finish loading. */
function mergeEnrichment(current: ArticleModel, update: ArticleModel): ArticleModel {
  const keep = <T>(now: Field<T>, next: Field<T>): Field<T> => ({
    ...next,
    override: now.override,
  });
  return {
    ...current,
    fields: {
      ...current.fields,
      image: keep(current.fields.image, update.fields.image),
      logo: keep(current.fields.logo, update.fields.logo),
    },
  };
}

function releaseUrls(article: ArticleModel | null): void {
  if (!article) return;
  const seen = new Set<string>();
  for (const f of [article.fields.image, article.fields.logo] as Array<
    Field<{ objectUrl: string }>
  >) {
    for (const item of [f.value, f.override, ...f.options.map((o) => o.value)]) {
      if (item && !seen.has(item.objectUrl)) {
        seen.add(item.objectUrl);
        revokeLoaded(item);
      }
    }
  }
}

export function createApp(root: HTMLElement, deps: AppDeps): App {
  const store = createStore<AppState>(initialState());
  const resolve = deps.resolve ?? resolveArticle;
  const exportActions = createExportActions(store);
  let controller: AbortController | null = null;
  let slowTimer: ReturnType<typeof setTimeout> | undefined;

  const set = (update: (s: AppState) => AppState) => store.set(update);
  const openDialog = (id: Exclude<DialogId, null>) =>
    set((s) => ({ ...s, ui: { ...s.ui, dialog: id } }));

  // ---- Loading ----------------------------------------------------------------------------------
  async function submit(text: string, source: InputSource = 'url'): Promise<void> {
    const parsed = normalizeInput(text);
    if (!parsed.ok) {
      if (store.get().phase === 'landing')
        set((s) => ({ ...s, inputError: MESSAGES.invalid, input: { ...s.input, url: text } }));
      else pushToast(store, MESSAGES.invalid, 'error');
      return;
    }
    controller?.abort();
    clearTimeout(slowTimer);
    const mine = new AbortController();
    controller = mine;
    root.dataset.pipeline = 'running';
    const host = new URL(parsed.url).hostname.replace(/^www\./, '');
    releaseUrls(store.get().article);
    set((s) => ({
      ...s,
      phase: 'loading',
      input: { url: parsed.url, source },
      article: null,
      failure: null,
      inputError: null,
      fit: null,
      notices: [],
      loading: { host, slow: false },
      ui: { ...s.ui, measured: null },
    }));
    slowTimer = setTimeout(
      () => set((s) => (s.loading ? { ...s, loading: { ...s.loading, slow: true } } : s)),
      4000,
    );

    const onEvent = ({ stage, model }: PipelineEvent) => {
      if (mine.signal.aborted) return;
      if (stage === 'done') root.dataset.pipeline = 'done';
      if (stage === 'content') {
        const outlet = findOutletById(deps.outlets, model.brand.outletId ?? '');
        set((s) => ({
          ...s,
          phase: 'editing',
          loading: null,
          article: model,
          style: styleForNewCard(s.style, outlet),
          notices: noticesFor(model),
        }));
        clearTimeout(slowTimer);
        if (source === 'url')
          history.replaceState(
            null,
            '',
            `${location.pathname}?url=${encodeURIComponent(parsed.url)}`,
          );
        document.title = `${effective(model.fields.title) ?? 'Card'} · News Card Maker`;
      } else {
        set((s) => (s.article ? { ...s, article: mergeEnrichment(s.article, model) } : s));
        if (
          stage === 'done' &&
          model.status !== 'blocked' &&
          !model.fields.image.value &&
          !model.fields.image.options.length
        ) {
          set((s) => ({
            ...s,
            notices: [...s.notices, 'No usable image found: upload one in the panel'],
          }));
        }
      }
    };

    try {
      await resolve(parsed.url, {
        proxyUrl: deps.proxyUrl,
        outlets: deps.outlets,
        signal: mine.signal,
        onEvent,
      });
    } catch (e) {
      if (mine.signal.aborted || (e as { name?: string })?.name === 'AbortError') return;
      clearTimeout(slowTimer);
      root.dataset.pipeline = 'failed';
      const failure = e instanceof PipelineError ? e : null;
      const message =
        failure?.code === 'INVALID_INPUT'
          ? MESSAGES.invalid
          : failure?.code === 'PROXY_UNAVAILABLE'
            ? MESSAGES.proxy
            : failure?.code === 'RATE_LIMITED'
              ? MESSAGES.rate
              : failure?.code === 'FETCH_FAILED'
                ? MESSAGES.fetch
                : failure?.code === 'HN_COMMENT'
                  ? failure.message
                  : failure?.code === 'HN_UNAVAILABLE'
                    ? MESSAGES.hn
                    : MESSAGES.unknown;
      set((s) => ({
        ...s,
        phase: 'landing',
        loading: null,
        article: null,
        inputError: message,
        failure: { code: failure?.code ?? 'UNKNOWN', message, link: failure?.link },
      }));
    } finally {
      if (controller === mine) clearTimeout(slowTimer);
    }
  }

  function newCard(): void {
    controller?.abort();
    clearTimeout(slowTimer);
    releaseUrls(store.get().article);
    set((s) => ({
      ...s,
      phase: 'landing',
      article: null,
      loading: null,
      failure: null,
      inputError: null,
      fit: null,
      notices: [],
      input: { url: '', source: 'url' },
      ui: { ...s.ui, dialog: null, measured: null },
    }));
    history.replaceState(null, '', location.pathname);
    document.title = 'News Card Maker';
  }

  // ---- Images and logos --------------------------------------------------------------------------
  const busy = async (job: () => Promise<void>) => {
    set((s) => ({ ...s, ui: { ...s.ui, busy: true } }));
    try {
      await job();
    } finally {
      set((s) => ({ ...s, ui: { ...s.ui, busy: false } }));
    }
  };
  const fail = (what: string) => pushToast(store, `That ${what} could not be loaded`, 'error');

  const panelDeps: PanelDeps = {
    loadImageCandidate: (i) =>
      busy(async () => {
        const candidate = store.get().article?.imageCandidates[i];
        if (!candidate) return;
        try {
          const loaded = await loadImage(deps.proxyUrl, candidate.value);
          set((s) =>
            withField(setPath(s, 'style.show.image', true), 'image', (f) => ({
              ...f,
              options: [
                ...f.options,
                {
                  value: loaded,
                  source: candidate.source,
                  score: candidate.score,
                  note: candidate.note,
                },
              ],
              override: loaded,
            })),
          );
        } catch {
          fail('image');
        }
      }),
    loadLogoCandidate: (i) =>
      busy(async () => {
        const candidate = store.get().article?.logoCandidates[i];
        if (!candidate) return;
        try {
          const loaded = await loadLogo(deps.proxyUrl, candidate.value);
          set((s) =>
            withField(setPath(s, 'style.show.logo', true), 'logo', (f) => ({
              ...f,
              options: [
                ...f.options,
                {
                  value: loaded,
                  source: candidate.source,
                  score: candidate.score,
                  note: candidate.note,
                },
              ],
              override: loaded,
            })),
          );
        } catch {
          fail('logo');
        }
      }),
    uploadImage: (file) =>
      busy(async () => {
        try {
          const loaded = await loadImageFromBlob(file, file.name);
          set((s) => setOverride(setPath(s, 'style.show.image', true), 'image', loaded));
        } catch {
          fail('image');
        }
      }),
    uploadLogo: (file) =>
      busy(async () => {
        try {
          const loaded = await loadLogoFromBlob(file, file.name);
          set((s) => setOverride(setPath(s, 'style.show.logo', true), 'logo', loaded));
        } catch {
          fail('logo');
        }
      }),
  };

  // ---- Views ---------------------------------------------------------------------------------------
  let panel!: Panel;
  const stage = createStage(store, {
    outlets: deps.outlets,
    hostLocale: deps.hostLocale,
    focusField: (id) => panel.focusField(id),
    dropImage: (file) => void panelDeps.uploadImage(file),
  });
  panel = createPanel(store, panelDeps);

  const landing = createLanding(store, { submit: (t) => void submit(t), openDialog });
  const editor = createEditor(store, {
    stage,
    panel,
    actions: exportActions,
    submit: (t) => void submit(t),
    newCard,
    openDialog,
    copyLink: () =>
      void navigator.clipboard?.writeText(location.href).then(
        () => pushToast(store, 'Link copied', 'success'),
        () => pushToast(store, 'Could not copy the link', 'error'),
      ),
    openOriginal: () => {
      const url = store.get().article?.finalUrl;
      if (url) window.open(url, '_blank', 'noopener');
    },
  });

  createDialogHost(store, { help: helpDialog });
  root.append(landing, editor.element, createToasts(store));

  store.subscribe(
    (s) => s.phase,
    (phase) => {
      landing.hidden = phase !== 'landing';
      editor.element.hidden = phase === 'landing';
      if (phase === 'landing') {
        document.title = 'News Card Maker';
        focusLanding(root);
      } else {
        stage.relayout();
      }
    },
    { immediate: true },
  );

  installShortcuts({
    focusUrl: () => (store.get().phase === 'landing' ? focusLanding(root) : editor.focusUrl()),
    openHelp: () => openDialog('help'),
    copy: () => void exportActions.copy(),
    download: () => void exportActions.download(store.get().style.export.format),
    submit: (t) => void submit(t),
    uploadImage: (f) => void panelDeps.uploadImage(f),
    editing: () => store.get().phase === 'editing',
  });

  return {
    store,
    stage,
    panel,
    editor,
    submit,
    newCard,
    start() {
      const initial = new URLSearchParams(location.search).get('url');
      if (initial) void submit(initial);
      else focusLanding(root);
    },
  };
}
