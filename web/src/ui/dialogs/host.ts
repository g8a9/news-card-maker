// Modal dialogs on top of the native <dialog> element: focus trap, Esc to close and a backdrop for free.
import { h } from '../../render/h.ts';
import type { AppState, DialogId } from '../../state/app-state.ts';
import type { Store } from '../../state/store.ts';
import { icon } from '../icons.ts';

export interface DialogContent {
  title: string;
  body: HTMLElement;
  /** Wide dialogs (page source) get more room. */
  wide?: boolean;
}

export type DialogBuilders = Partial<Record<Exclude<DialogId, null>, () => DialogContent>>;

export function createDialogHost(store: Store<AppState>, builders: DialogBuilders): void {
  let open: HTMLDialogElement | null = null;

  const close = () =>
    store.set((s) => (s.ui.dialog === null ? s : { ...s, ui: { ...s.ui, dialog: null } }));

  store.subscribe(
    (s) => s.ui.dialog,
    (id) => {
      if (open) {
        const old = open;
        open = null;
        if (old.open) old.close();
        old.remove();
      }
      if (!id) return;
      const build = builders[id];
      if (!build) return close();
      const content = build();
      const titleId = `dialog-title-${id}`;
      const dialog = h(
        'dialog',
        { class: `dialog${content.wide ? ' dialog-wide' : ''}`, 'aria-labelledby': titleId },
        h(
          'div',
          { class: 'dialog-head' },
          h('h2', { id: titleId, class: 'dialog-title' }, content.title),
          h(
            'button',
            {
              type: 'button',
              class: 'icon-btn',
              'aria-label': 'Close',
              on: { click: () => dialog.close() },
            },
            icon('x', 16),
          ),
        ),
        content.body,
      );
      dialog.addEventListener('close', () => {
        if (open === dialog) {
          open = null;
          close();
        }
        dialog.remove();
      });
      // A click on the backdrop (the dialog element itself, outside its content) closes it.
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
      document.body.append(dialog);
      open = dialog;
      dialog.showModal();
    },
    { immediate: true },
  );
}
