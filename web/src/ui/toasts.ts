import { h } from '../render/h.ts';
import type { AppState, Toast } from '../state/app-state.ts';
import type { Store } from '../state/store.ts';

let nextId = 1;

/** Shows a toast and removes it again after a few seconds. Returns its id. */
export function pushToast(
  store: Store<AppState>,
  text: string,
  kind: Toast['kind'] = 'info',
): number {
  const id = nextId++;
  store.set((s) => ({ ...s, ui: { ...s.ui, toasts: [...s.ui.toasts, { id, text, kind }] } }));
  setTimeout(() => dismissToast(store, id), kind === 'error' ? 6000 : 3200);
  return id;
}

export function dismissToast(store: Store<AppState>, id: number): void {
  store.set((s) => ({ ...s, ui: { ...s.ui, toasts: s.ui.toasts.filter((t) => t.id !== id) } }));
}

/** The aria-live region: screen readers hear every toast, and so does the status line. */
export function createToasts(store: Store<AppState>): HTMLElement {
  const region = h('div', {
    class: 'toasts',
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'false',
  });
  const render = (toasts: Toast[]) => {
    region.replaceChildren(
      ...toasts.map((t) =>
        h('div', { class: `toast toast-${t.kind}`, dataset: { id: t.id } }, t.text),
      ),
    );
  };
  store.subscribe((s) => s.ui.toasts, render, { immediate: true });
  return region;
}
