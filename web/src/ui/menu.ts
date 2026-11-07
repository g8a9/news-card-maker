// A small popup menu: a button that opens a list of actions. Closes on Esc, outside click and selection.
import { h } from '../render/h.ts';

export interface MenuItem {
  label: string;
  run(): void;
}

export function createMenu(
  trigger: HTMLButtonElement,
  items: () => MenuItem[],
  options: { align?: 'start' | 'end' } = {},
): HTMLElement {
  const list = h('div', {
    class: `menu-list menu-${options.align ?? 'start'}`,
    role: 'menu',
    hidden: true,
  });
  const wrap = h('div', { class: 'menu' }, trigger, list);
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');

  const close = (refocus = false) => {
    list.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (refocus) trigger.focus();
  };
  const open = () => {
    list.replaceChildren(
      ...items().map((item) =>
        h(
          'button',
          {
            type: 'button',
            role: 'menuitem',
            class: 'menu-item',
            on: {
              click: () => {
                close(true);
                item.run();
              },
            },
          },
          item.label,
        ),
      ),
    );
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    list.querySelector<HTMLElement>('.menu-item')?.focus();
  };

  trigger.addEventListener('click', () => (list.hidden ? open() : close()));
  wrap.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !list.hidden) {
      event.stopPropagation();
      close(true);
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !list.hidden) {
      event.preventDefault();
      const buttons = [...list.querySelectorAll<HTMLElement>('.menu-item')];
      const at = buttons.indexOf(document.activeElement as HTMLElement);
      const next = (at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    } else if (event.key === 'ArrowDown' && event.target === trigger) {
      event.preventDefault();
      open();
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!list.hidden && !wrap.contains(event.target as Node)) close();
  });
  list.addEventListener('focusout', (event) => {
    const to = event.relatedTarget as Node | null;
    if (!list.hidden && to && !wrap.contains(to)) close();
  });
  return wrap;
}
