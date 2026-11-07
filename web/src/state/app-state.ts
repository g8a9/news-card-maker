import type { ArticleModel } from '../core/types.ts';
import type { FitReport } from '../render/fit.ts';
import { type CardStyle, defaultStyle } from '../render/style.ts';

export type Phase = 'landing' | 'loading' | 'editing';
export type InputSource = 'url' | 'bookmarklet' | 'paste' | 'manual';
export type DialogId = 'help' | 'bookmarklet' | 'paste-source' | 'copy-fallback' | 'manual' | null;

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

export interface LoadFailure {
  code: string;
  message: string;
  /** For example the story to open instead of a Hacker News comment. */
  link?: string;
}

export interface AppState {
  phase: Phase;
  input: { url: string; source: InputSource };
  article: ArticleModel | null;
  style: CardStyle;
  /** Set while text is being read; `slow` flips on after a few seconds. */
  loading: { host: string; slow: boolean } | null;
  /** A load that ended without a card (shown on the landing page or as an empty state). */
  failure: LoadFailure | null;
  /** Inline validation message under the landing input. */
  inputError: string | null;
  fit: FitReport | null;
  /** Notes about the current card: provenance, fitting, image problems. */
  notices: string[];
  ui: {
    /** Panel sections that are open (desktop) / the visible tab (mobile). */
    openSections: string[];
    activeSection: string;
    toasts: Toast[];
    dialog: DialogId;
    /** Image or logo currently being loaded from a candidate or an upload. */
    busy: boolean;
    /** Logical size of the card on the stage (frame included). */
    measured: { width: number; height: number } | null;
  };
}

export function initialState(): AppState {
  return {
    phase: 'landing',
    input: { url: '', source: 'url' },
    article: null,
    style: defaultStyle(),
    loading: null,
    failure: null,
    inputError: null,
    fit: null,
    notices: [],
    ui: {
      openSections: ['content', 'layout'],
      activeSection: 'content',
      toasts: [],
      dialog: null,
      busy: false,
      measured: null,
    },
  };
}
