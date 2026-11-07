// The app: wires the store, the pipeline, the two views (landing and editor), shortcuts and dialogs.
import { hasBookmarklet, readBookmarklet } from '../bookmarklet/receive.ts';
import { toIsoDate } from '../core/dates.ts';
import type { ManualInput } from '../core/manual.ts';
import { findOutletById, type Outlet } from '../core/registry.ts';
import { type ArticleModel, effective, type Field } from '../core/types.ts';
import { normalizeInput } from '../core/url.ts';
import { createExportActions, type ExportActions } from '../export/actions.ts';
import {
  loadImage,
  loadImageFromBlob,
  loadLogo,
  loadLogoFromBlob,
  revokeLoaded,
} from '../net/images.ts';
import {
  PipelineError,
  type PipelineEvent,
  type PipelineOptions,
  resolveArticle,
  resolveFromHtml,
  resolveManual,
} from '../net/pipeline.ts';
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
import { bookmarkletDialog } from './dialogs/bookmarklet.ts';
import { copyFallbackDialog, holdFallbackBlob } from './dialogs/copy-fallback.ts';
import { helpDialog } from './dialogs/help.ts';
import { createDialogHost } from './dialogs/host.ts';
import { manualDialog } from './dialogs/manual.ts';
import { pasteSourceDialog, readSourceFile, type SourceFile } from './dialogs/paste-source.ts';
import { createEditor, type Editor } from './editor.ts';
import { installFileDrop } from './file-drop.ts';
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
  resolveSource?: typeof resolveFromHtml;
  resolveManual?: typeof resolveManual;
}

export interface App {
  store: Store<AppState>;
  stage: Stage;
  panel: Panel;
  editor: Editor;
  start(): void;
  submit(text: string, source?: InputSource): Promise<void>;
  submitSource(html: string, pageUrl: string, provenance: 'bookmarklet' | 'paste'): Promise<void>;
  submitManual(input: ManualInput): Promise<void>;
  newCard(): void;
}

const MESSAGES = {
  invalid: 'Paste a full link, starting with https://',
  proxy: 'The fetch service is unavailable. Try again in a minute, or paste the page source.',
  rate: 'Too many requests right now. Try again in a minute.',
  fetch: "We couldn't read that page. Try the bookmarklet, or paste the page source.",
  hn: "Hacker News didn't answer. Try again in a minute.",
  unknown: 'Something went wrong while reading that page. Try again, or paste the page source.',
  bookmarklet:
    "The bookmarklet's data wasn't valid. Run the bookmarklet again, or paste the page source.",
} as const;

/** What the manual dialog starts with: whatever was found on the page, else nothing. */
function manualPrefill(article: ArticleModel | null, typedUrl: string) {
  const link = article?.finalUrl || (normalizeInput(typedUrl).ok ? typedUrl.trim() : '');
  const published = article ? effective(article.fields.published) : null;
  return {
    title: (article && effective(article.fields.title)) || undefined,
    description: (article && effective(article.fields.description)) || undefined,
    siteName: (article && effective(article.fields.siteName)) || undefined,
    outletId: article?.brand.outletId,
    url: link || undefined,
    date: published ? toIsoDate(published) : undefined,
  };
}

const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

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
  const resolveSource = deps.resolveSource ?? resolveFromHtml;
  const resolveByHand = deps.resolveManual ?? resolveManual;
  let exportActions!: ExportActions;
  let controller: AbortController | null = null;
  let slowTimer: ReturnType<typeof setTimeout> | undefined;
  /** A saved page dropped on the page, waiting for the paste-source dialog to pick it up. */
  let pendingFile: SourceFile | null = null;

  const set = (update: (s: AppState) => AppState) => store.set(update);
  const openDialog = (id: Exclude<DialogId, null>) =>
    set((s) => ({ ...s, ui: { ...s.ui, dialog: id } }));
  const closeDialog = () => set((s) => (s.ui.dialog ? { ...s, ui: { ...s.ui, dialog: null } } : s));

  // ---- Loading ----------------------------------------------------------------------------------
  interface LoadSpec {
    /** The address the card is about; empty when it has none (manual cards). */
    url: string;
    source: InputSource;
    /** Shown as "Reading {host}…"; empty for sources that need no reading. */
    host: string;
    run(options: PipelineOptions): Promise<ArticleModel>;
  }

  async function submit(text: string, source: InputSource = 'url'): Promise<void> {
    const parsed = normalizeInput(text);
    if (!parsed.ok) {
      if (store.get().phase === 'landing')
        set((s) => ({ ...s, inputError: MESSAGES.invalid, input: { ...s.input, url: text } }));
      else pushToast(store, MESSAGES.invalid, 'error');
      return;
    }
    const url = parsed.url;
    return load({
      url,
      source,
      host: new URL(url).hostname.replace(/^www\./, ''),
      run: (options) => resolve(url, options),
    });
  }

  /** Page source the reader supplied: from the bookmarklet, or pasted or dropped. */
  const submitSource = (html: string, pageUrl: string, provenance: 'bookmarklet' | 'paste') =>
    load({
      url: pageUrl,
      source: provenance,
      host: '',
      run: (options) => resolveSource(html, pageUrl, provenance, options),
    });

  const submitManual = (input: ManualInput) =>
    load({
      url: input.url ?? '',
      source: 'manual',
      host: '',
      run: (options) => resolveByHand(input, options),
    });

  async function load(spec: LoadSpec): Promise<void> {
    const { source, host } = spec;
    controller?.abort();
    clearTimeout(slowTimer);
    const mine = new AbortController();
    controller = mine;
    root.dataset.pipeline = 'running';
    releaseUrls(store.get().article);
    set((s) => ({
      ...s,
      phase: 'loading',
      input: { url: spec.url, source },
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
        // Only a link can be reloaded; a card made from source or by hand cannot.
        history.replaceState(
          null,
          '',
          source === 'url'
            ? `${location.pathname}?url=${encodeURIComponent(spec.url)}`
            : location.pathname,
        );
        const headline = effective(model.fields.title);
        document.title = headline ? `${headline} · News Card Maker` : 'News Card Maker';
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
      await spec.run({
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
  exportActions = createExportActions({
    store,
    stage,
    openFallback: (blob) => {
      holdFallbackBlob(blob);
      openDialog('copy-fallback');
    },
  });

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

  createDialogHost(store, {
    help: helpDialog,
    'copy-fallback': () => copyFallbackDialog(() => void exportActions.download('png')),
    bookmarklet: () =>
      bookmarkletDialog({ appUrl: `${location.origin}${location.pathname}`, copyText }),
    'paste-source': () => {
      const initialFile = pendingFile;
      pendingFile = null;
      const s = store.get();
      return pasteSourceDialog({
        initialUrl: s.article?.finalUrl || s.input.url,
        initialFile,
        submit: (html, url) => {
          closeDialog();
          void submitSource(html, url, 'paste');
        },
      });
    },
    manual: () => {
      const s = store.get();
      return manualDialog({
        outlets: deps.outlets,
        prefill: manualPrefill(s.article, s.input.url),
        submit: (input) => {
          closeDialog();
          void submitManual(input);
        },
      });
    },
  });
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

  // There is nothing to copy, download or add an image to until a page has been read.
  const hasCard = () => {
    const { phase, article } = store.get();
    return phase === 'editing' && !!article && article.status !== 'blocked';
  };

  installShortcuts({
    focusUrl: () => (store.get().phase === 'landing' ? focusLanding(root) : editor.focusUrl()),
    openHelp: () => openDialog('help'),
    copy: () => void exportActions.copy(),
    download: () => void exportActions.download(store.get().style.export.format),
    submit: (t) => void submit(t),
    uploadImage: (f) => void panelDeps.uploadImage(f),
    editing: hasCard,
  });

  /** A saved web page dropped on the page: open the paste dialog with it ready. */
  async function openSourceFromFile(file: File): Promise<void> {
    try {
      pendingFile = await readSourceFile(file);
    } catch (e) {
      return void pushToast(
        store,
        e instanceof Error ? e.message : 'That file could not be read',
        'error',
      );
    }
    // A dialog that is already open is rebuilt, so it picks the file up.
    closeDialog();
    store.flush();
    openDialog('paste-source');
  }

  installFileDrop({
    editing: hasCard,
    dropHtml: (file) => void openSourceFromFile(file),
    dropImage: (file) => void panelDeps.uploadImage(file),
    rejected: () => pushToast(store, 'Drop a saved web page (.html) or an image', 'info'),
  });

  /** `#bm=…` on arrival: the bookmarklet handed over the page it was run on. */
  async function receiveBookmarklet(): Promise<void> {
    if (!hasBookmarklet(location.hash)) return;
    const hash = location.hash;
    // The payload never stays in the address bar or in the history entry.
    history.replaceState(null, '', location.pathname);
    try {
      const payload = await readBookmarklet(hash);
      if (payload) await submitSource(payload.html, payload.url, 'bookmarklet');
    } catch {
      root.dataset.pipeline = 'failed';
      set((s) => ({
        ...s,
        phase: 'landing',
        loading: null,
        article: null,
        inputError: MESSAGES.bookmarklet,
        failure: { code: 'BOOKMARKLET', message: MESSAGES.bookmarklet },
      }));
    }
  }

  return {
    store,
    stage,
    panel,
    editor,
    submit,
    submitSource,
    submitManual,
    newCard,
    start() {
      window.addEventListener('hashchange', () => void receiveBookmarklet());
      if (hasBookmarklet(location.hash)) return void receiveBookmarklet();
      const initial = new URLSearchParams(location.search).get('url');
      if (initial) void submit(initial);
      else focusLanding(root);
    },
  };
}
