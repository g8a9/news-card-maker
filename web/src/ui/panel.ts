// The settings panel (PLAN.md §9.3, §9.4): collapsible sections on desktop, tabs below 1024 px,
// generated entirely from the schema in controls/schema.ts.
import { h } from '../render/h.ts';
import type { AppState } from '../state/app-state.ts';
import type { Store } from '../state/store.ts';
import { buildControl, type ControlInstance, type PanelDeps } from './controls/build.ts';
import { SECTIONS } from './controls/schema.ts';
import { icon } from './icons.ts';

export interface Panel {
  element: HTMLElement;
  /** Opens the field's section and focuses its main input. */
  focusField(id: string): void;
}

const NARROW = '(max-width: 1023px)';

export function createPanel(store: Store<AppState>, deps: PanelDeps): Panel {
  const instances = new Map<
    string,
    { control: ControlInstance; section: string; visibleIf?: (s: AppState) => boolean }
  >();
  const narrow = window.matchMedia(NARROW);

  const sections = SECTIONS.map((section) => {
    const bodyId = `section-${section.id}`;
    const body = h('div', { class: 'section-body', id: bodyId });
    for (const spec of section.controls) {
      const control = buildControl(spec, store, deps);
      instances.set(spec.id, { control, section: section.id, visibleIf: spec.visibleIf });
      body.append(control.el);
    }
    const head = h(
      'button',
      {
        type: 'button',
        class: 'section-head',
        id: `${bodyId}-head`,
        'aria-expanded': 'true',
        'aria-controls': bodyId,
        on: {
          click: () =>
            store.set((s) => {
              const open = s.ui.openSections.includes(section.id);
              return {
                ...s,
                ui: {
                  ...s.ui,
                  openSections: open
                    ? s.ui.openSections.filter((x) => x !== section.id)
                    : [...s.ui.openSections, section.id],
                },
              };
            }),
        },
      },
      h('span', null, section.title),
      icon('chevron-down', 14),
    );
    const el = h(
      'section',
      { class: 'panel-section', dataset: { section: section.id } },
      h('h2', { class: 'section-title' }, head),
      body,
    );
    return { id: section.id, title: section.title, el, head, body };
  });

  const tabs = h(
    'div',
    { class: 'panel-tabs', role: 'tablist', 'aria-label': 'Settings sections' },
    ...sections.map((s) =>
      h(
        'button',
        {
          type: 'button',
          role: 'tab',
          class: 'panel-tab',
          id: `tab-${s.id}`,
          'aria-controls': `section-${s.id}`,
          dataset: { section: s.id },
          on: {
            click: () => store.set((st) => ({ ...st, ui: { ...st.ui, activeSection: s.id } })),
          },
        },
        s.title,
      ),
    ),
  );

  const element = h(
    'aside',
    { class: 'panel', 'aria-label': 'Card settings' },
    tabs,
    h('div', { class: 'panel-scroll' }, ...sections.map((s) => s.el)),
  );

  function update(): void {
    const state = store.get();
    const isNarrow = narrow.matches;
    element.toggleAttribute('inert', !state.article);
    element.classList.toggle('is-disabled', !state.article);
    for (const s of sections) {
      const open = isNarrow
        ? state.ui.activeSection === s.id
        : state.ui.openSections.includes(s.id);
      s.head.setAttribute('aria-expanded', String(open));
      s.body.hidden = !open;
      s.el.classList.toggle('is-open', open);
    }
    for (const tab of tabs.querySelectorAll<HTMLElement>('.panel-tab')) {
      const on = tab.dataset.section === state.ui.activeSection;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    for (const { control, visibleIf } of instances.values()) {
      control.el.hidden = visibleIf ? !visibleIf(state) : false;
      control.update(state);
    }
  }

  store.subscribe((s) => s, update, { equals: () => false, immediate: true });
  narrow.addEventListener('change', update);
  update();

  return {
    element,
    focusField(id) {
      const found = instances.get(id);
      if (!found) return;
      store.set((s) => ({
        ...s,
        ui: {
          ...s.ui,
          activeSection: found.section,
          openSections: s.ui.openSections.includes(found.section)
            ? s.ui.openSections
            : [...s.ui.openSections, found.section],
        },
      }));
      store.flush();
      found.control.focus();
      found.control.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
  };
}
