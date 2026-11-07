// Builds one control from its schema entry (PLAN.md §9.4). Every control reads from and writes to the
// store: the DOM is a view of the state, updated only where a value really differs, so typing never
// loses the caret.

import { normalizeColor } from '../../core/color.ts';
import { parseDate, toIsoDate } from '../../core/dates.ts';
import { splitAuthors, truncate } from '../../core/text.ts';
import { type ArticleModel, effective, type Field } from '../../core/types.ts';
import { h } from '../../render/h.ts';
import { resolveSize, SIZE_PRESETS, type SizePreset } from '../../render/style.ts';
import type { AppState } from '../../state/app-state.ts';
import { clearOverride, type FieldName, hasOverride, setOverride } from '../../state/fields.ts';
import { getPath, setPath } from '../../state/paths.ts';
import type { Store } from '../../state/store.ts';
import { icon } from '../icons.ts';
import { sourceLabel } from './labels.ts';
import type { Control, Option } from './schema.ts';

export interface PanelDeps {
  loadImageCandidate(index: number): Promise<void>;
  loadLogoCandidate(index: number): Promise<void>;
  uploadImage(file: File): Promise<void>;
  uploadLogo(file: File): Promise<void>;
}

export interface ControlInstance {
  id: string;
  el: HTMLElement;
  update(state: AppState): void;
  /** Moves focus to the control's main input. */
  focus(): void;
}

const FIELD_PREFIX = 'article.fields.';
const fieldNameOf = (path: string): FieldName => path.slice(FIELD_PREFIX.length) as FieldName;
const isField = (path: string) => path.startsWith(FIELD_PREFIX);

function read(s: AppState, path: string): unknown {
  if (isField(path)) {
    const field = s.article?.fields[fieldNameOf(path)] as Field<unknown> | undefined;
    return field ? effective(field) : null;
  }
  return getPath(s, path);
}

function write(s: AppState, path: string, value: unknown): AppState {
  return isField(path) ? setOverride(s, fieldNameOf(path), value) : setPath(s, path, value);
}

let uid = 0;
const nextId = (base: string) => `${base}-${++uid}`;

// ---- Small parts ---------------------------------------------------------------------------------

function switchButton(
  label: string,
  onToggle: (next: boolean) => void,
): HTMLButtonElement & { set(on: boolean): void } {
  const btn = h(
    'button',
    {
      type: 'button',
      role: 'switch',
      class: 'switch',
      'aria-checked': 'false',
      'aria-label': label,
    },
    h('span', { class: 'switch-knob' }),
  ) as HTMLButtonElement & { set(on: boolean): void };
  btn.addEventListener('click', () => onToggle(btn.getAttribute('aria-checked') !== 'true'));
  btn.set = (on) => btn.setAttribute('aria-checked', String(on));
  return btn;
}

function shell(
  control: { id: string; label: string; help?: string },
  body: HTMLElement,
  labelFor: string | null,
  extras: Array<HTMLElement | null> = [],
): { el: HTMLElement; head: HTMLElement } {
  const labelEl = labelFor
    ? h('label', { class: 'field-label', for: labelFor }, control.label)
    : h('span', { class: 'field-label', id: `${control.id}-label` }, control.label);
  const head = h(
    'div',
    { class: 'field-head' },
    labelEl,
    h('span', { class: 'field-extras' }, ...extras),
  );
  const el = h(
    'div',
    { class: 'field', dataset: { fieldId: control.id } },
    head,
    body,
    control.help ? h('p', { class: 'field-help' }, control.help) : null,
  );
  return { el, head };
}

/** The "show" companion: a switch in the header that turns the field on or off on the card. */
function showToggle(store: Store<AppState>, control: { label: string }, path: string | undefined) {
  if (!path) return null;
  const sw = switchButton(`Show ${control.label.toLowerCase()}`, (on) =>
    store.set((s) => setPath(s, path, on)),
  );
  return { sw, update: (s: AppState) => sw.set(getPath(s, path) !== false) };
}

function resetButton(store: Store<AppState>, name: FieldName): HTMLButtonElement {
  return h(
    'button',
    {
      type: 'button',
      class: 'icon-btn icon-btn-sm',
      title: 'Reset to the value found on the page',
      'aria-label': 'Reset to the value found on the page',
      hidden: true,
      on: { click: () => store.set((s) => clearOverride(s, name)) },
    },
    icon('reset', 14),
  );
}

const keyOf = (v: unknown) => String(v);

// ---- Control types -------------------------------------------------------------------------------

function textControl(
  control: Extract<Control, { type: 'text' | 'textarea' }>,
  store: Store<AppState>,
): ControlInstance {
  const id = nextId(control.id);
  const name = fieldNameOf(control.path);
  const input =
    control.type === 'textarea'
      ? h('textarea', {
          id,
          class: 'input',
          rows: control.rows ?? 3,
          spellcheck: 'true',
          placeholder: control.placeholder,
        })
      : h('input', {
          id,
          class: 'input',
          type: 'text',
          spellcheck: 'true',
          placeholder: control.placeholder,
        });
  input.addEventListener('input', () => store.set((s) => setOverride(s, name, input.value)));

  const reset = resetButton(store, name);
  const toggle = showToggle(store, control, control.show);
  const alt = control.alternatives
    ? h('select', {
        class: 'select select-alt',
        'aria-label': `${control.label}: alternatives`,
        hidden: true,
      })
    : null;
  alt?.addEventListener('change', () => {
    const picked = alt.value;
    if (picked !== '') store.set((s) => setOverride(s, name, picked));
    alt.value = '';
  });

  const body = h('div', { class: 'field-body' }, input, alt);
  const { el } = shell(control, body, id, [reset, toggle?.sw ?? null]);

  const kind = control.id === 'description' ? 'description' : 'title';
  let altSignature = '';
  return {
    id: control.id,
    el,
    focus: () => input.focus(),
    update(s) {
      const value = (read(s, control.path) as string | null) ?? '';
      if (input.value !== value) input.value = value;
      const off = control.show ? getPath(s, control.show) === false : false;
      input.disabled = off || !s.article;
      reset.hidden = !hasOverride(s, name);
      toggle?.update(s);
      if (alt && s.article) {
        const field = s.article.fields[name] as Field<string>;
        const options = field.options.filter((o) => o.value !== value);
        const signature = options.map((o) => `${o.source}:${o.value}`).join('|') + value;
        if (signature !== altSignature) {
          altSignature = signature;
          alt.replaceChildren(
            h(
              'option',
              { value: '', disabled: true, selected: true },
              `Alternatives (${options.length})`,
            ),
            ...options.map((o) =>
              h(
                'option',
                { value: o.value },
                `${sourceLabel(o.source, o.note, kind)}: ${truncate(o.value, 52)}`,
              ),
            ),
          );
        }
        alt.hidden = options.length === 0;
      }
    },
  };
}

function authorsControl(
  control: Extract<Control, { type: 'authors' }>,
  store: Store<AppState>,
): ControlInstance {
  const id = nextId(control.id);
  const input = h('input', {
    id,
    class: 'input',
    type: 'text',
    placeholder: 'Jane Roe, Sam Okafor',
  });
  input.addEventListener('input', () =>
    store.set((s) => setOverride(s, 'authors', splitAuthors(input.value))),
  );
  const toggle = showToggle(store, control, control.show);
  const reset = resetButton(store, 'authors');
  const { el } = shell(control, h('div', { class: 'field-body' }, input), id, [
    reset,
    toggle?.sw ?? null,
  ]);
  return {
    id: control.id,
    el,
    focus: () => input.focus(),
    update(s) {
      const names = (read(s, control.path) as string[] | null) ?? [];
      const text = names.join(', ');
      if (document.activeElement !== input && input.value !== text) input.value = text;
      input.disabled = !s.article || (control.show ? getPath(s, control.show) === false : false);
      reset.hidden = !hasOverride(s, 'authors');
      toggle?.update(s);
    },
  };
}

function dateControl(
  control: Extract<Control, { type: 'date' }>,
  store: Store<AppState>,
): ControlInstance {
  const id = nextId(control.id);
  const input = h('input', { id, class: 'input', type: 'date' });
  input.addEventListener('change', () => {
    const parsed = parseDate(input.value);
    store.set((s) => setOverride(s, 'published', parsed ?? null));
  });
  const toggle = showToggle(store, control, control.show);
  const reset = resetButton(store, 'published');
  const { el } = shell(control, h('div', { class: 'field-body' }, input), id, [
    reset,
    toggle?.sw ?? null,
  ]);
  return {
    id: control.id,
    el,
    focus: () => input.focus(),
    update(s) {
      const d = read(s, control.path) as { y: number; m: number; d: number } | null;
      const text = d ? toIsoDate({ raw: '', y: d.y, m: d.m, d: d.d, offsetMin: null }) : '';
      if (input.value !== text) input.value = text;
      input.disabled = !s.article || (control.show ? getPath(s, control.show) === false : false);
      reset.hidden = !hasOverride(s, 'published');
      toggle?.update(s);
    },
  };
}

function toggleControl(
  control: Extract<Control, { type: 'toggle' }>,
  store: Store<AppState>,
): ControlInstance {
  const sw = switchButton(control.label, (on) => store.set((s) => setPath(s, control.path, on)));
  sw.id = nextId(control.id);
  const row = h(
    'div',
    { class: 'field field-inline', dataset: { fieldId: control.id } },
    h('label', { class: 'field-label', for: sw.id }, control.label),
    sw,
    control.help ? h('p', { class: 'field-help' }, control.help) : null,
  );
  return {
    id: control.id,
    el: row,
    focus: () => sw.focus(),
    update: (s) => sw.set(getPath(s, control.path) === true),
  };
}

function selectControl(
  control: Extract<Control, { type: 'select' }>,
  store: Store<AppState>,
): ControlInstance {
  const id = nextId(control.id);
  const select = h(
    'select',
    { id, class: 'select' },
    ...control.options.map((o) => h('option', { value: keyOf(o.value) }, o.label)),
  );
  select.addEventListener('change', () => {
    const picked = control.options.find((o) => keyOf(o.value) === select.value);
    if (picked) store.set((s) => write(s, control.path, picked.value));
  });
  const toggle = showToggle(store, control, control.show);
  const { el } = shell(control, h('div', { class: 'field-body' }, select), id, [
    toggle?.sw ?? null,
  ]);
  return {
    id: control.id,
    el,
    focus: () => select.focus(),
    update(s) {
      const value = keyOf(read(s, control.path));
      if (select.value !== value) select.value = value;
      toggle?.update(s);
    },
  };
}

function segmentedControl(
  control: Extract<Control, { type: 'segmented' }>,
  store: Store<AppState>,
): ControlInstance {
  const labelId = `${control.id}-${++uid}-label`;
  const buttons = control.options.map((o: Option) =>
    h(
      'button',
      {
        type: 'button',
        role: 'radio',
        class: 'seg-btn',
        'aria-checked': 'false',
        tabindex: -1,
        title: o.title,
        dataset: { key: keyOf(o.value) },
      },
      o.icon ? icon(o.icon, 15) : null,
      o.label,
    ),
  );
  const group = h(
    'div',
    { class: 'segmented', role: 'radiogroup', 'aria-labelledby': labelId },
    ...buttons,
  );
  const choose = (i: number) => {
    const option = control.options[i];
    if (option) store.set((s) => write(s, control.path, option.value));
  };
  buttons.forEach((btn, i) => {
    btn.addEventListener('click', () => choose(i));
  });
  group.addEventListener('keydown', (event) => {
    const keys: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    };
    const step = keys[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const current = buttons.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    const next = (Math.max(0, current) + step + buttons.length) % buttons.length;
    choose(next);
    buttons[next]?.focus();
  });
  const toggle = showToggle(store, control, control.show);
  const label = h('span', { class: 'field-label', id: labelId }, control.label);
  const el = h(
    'div',
    { class: 'field', dataset: { fieldId: control.id } },
    h(
      'div',
      { class: 'field-head' },
      label,
      h('span', { class: 'field-extras' }, toggle?.sw ?? null),
    ),
    group,
  );
  return {
    id: control.id,
    el,
    focus: () => (buttons.find((b) => b.tabIndex === 0) ?? buttons[0])?.focus(),
    update(s) {
      const current = keyOf(read(s, control.path));
      for (const btn of buttons) {
        const on = btn.dataset.key === current;
        btn.setAttribute('aria-checked', String(on));
        btn.tabIndex = on ? 0 : -1;
      }
      if (!buttons.some((b) => b.tabIndex === 0) && buttons[0]) buttons[0].tabIndex = 0;
      toggle?.update(s);
    },
  };
}

function sliderControl(
  control: Extract<Control, { type: 'slider' }>,
  store: Store<AppState>,
): ControlInstance {
  const id = nextId(control.id);
  const input = h('input', {
    id,
    class: 'slider',
    type: 'range',
    min: control.min,
    max: control.max,
    step: control.step,
  });
  const output = h('output', { class: 'slider-value', for: id });
  const fmt = control.format ?? String;
  input.addEventListener('input', () =>
    store.set((s) => setPath(s, control.path, Number(input.value))),
  );
  const { el } = shell(control, h('div', { class: 'field-body slider-row' }, input, output), id);
  return {
    id: control.id,
    el,
    focus: () => input.focus(),
    update(s) {
      const value = Number(read(s, control.path));
      if (document.activeElement !== input || Number(input.value) !== value)
        input.value = String(value);
      output.textContent = fmt(value);
    },
  };
}

const ACCENT_PRESETS = ['#111111', '#2563EB', '#DC2626', '#16A34A', '#D97706', '#7C3AED'];

function swatchesControl(
  control: Extract<Control, { type: 'swatches' }>,
  store: Store<AppState>,
): ControlInstance {
  const labelId = `${control.id}-${++uid}-label`;
  const list = h('div', { class: 'swatches', role: 'radiogroup', 'aria-labelledby': labelId });
  const custom = h('input', {
    class: 'swatch-custom',
    type: 'color',
    'aria-label': 'Custom accent colour',
    value: '#2563eb',
  });
  custom.addEventListener('input', () =>
    store.set((s) => setPath(s, control.path, normalizeColor(custom.value))),
  );
  const el = h(
    'div',
    { class: 'field', dataset: { fieldId: control.id } },
    h(
      'div',
      { class: 'field-head' },
      h('span', { class: 'field-label', id: labelId }, control.label),
    ),
    h('div', { class: 'field-body swatch-row' }, list, custom),
  );
  let signature = '';
  return {
    id: control.id,
    el,
    focus: () => list.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(),
    update(s) {
      const current = (getPath(s, control.path) as string | null) ?? null;
      const palette = [
        ...new Set(
          [...(s.article?.brand.palette ?? []), ...ACCENT_PRESETS]
            .map((c) => normalizeColor(c))
            .filter((c): c is string => !!c),
        ),
      ];
      const sig = `${palette.join(',')}|${current}`;
      if (sig === signature) return;
      signature = sig;
      const make = (value: string | null, label: string, color: string | null) =>
        h(
          'button',
          {
            type: 'button',
            role: 'radio',
            class: `swatch${value === null ? ' swatch-auto' : ''}`,
            'aria-checked': String(current === value),
            'aria-label': label,
            title: label,
            style: color ? { background: color } : undefined,
            on: { click: () => store.set((st) => setPath(st, control.path, value)) },
          },
          value === null ? 'Auto' : null,
        );
      list.replaceChildren(
        make(null, 'Automatic accent', null),
        ...palette.map((c) => make(c, `Accent ${c}`, c)),
      );
      if (current) custom.value = current.toLowerCase();
    },
  };
}

const PRESET_LABELS: Array<[SizePreset, string]> = [
  ['auto', 'Auto (height follows content)'],
  ['16:9', '16:9'],
  ['4:3', '4:3'],
  ['3:2', '3:2'],
  ['1.91:1', '1.91:1 (link preview)'],
  ['2:1', '2:1'],
  ['1:1', '1:1'],
  ['4:5', '4:5'],
  ['9:16', '9:16'],
  ['custom', 'Custom…'],
];

function sizeControl(
  control: Extract<Control, { type: 'size' }>,
  store: Store<AppState>,
): ControlInstance {
  const id = nextId(control.id);
  const select = h(
    'select',
    { id, class: 'select' },
    ...PRESET_LABELS.map(([v, l]) => h('option', { value: v }, l)),
  );
  const w = h('input', {
    class: 'input input-num',
    type: 'number',
    min: 320,
    max: 4000,
    step: 10,
    'aria-label': 'Custom width in pixels',
  });
  const hh = h('input', {
    class: 'input input-num',
    type: 'number',
    min: 320,
    max: 4000,
    step: 10,
    'aria-label': 'Custom height in pixels',
  });
  const custom = h(
    'div',
    { class: 'size-custom', hidden: true },
    w,
    h('span', { class: 'size-x', 'aria-hidden': 'true' }, '×'),
    hh,
  );
  select.addEventListener('change', () => {
    const preset = select.value as SizePreset;
    store.set((s) => {
      const now = resolveSize(s.style.size);
      const width =
        preset === 'custom' || preset === 'auto'
          ? now.width
          : (SIZE_PRESETS[preset as keyof typeof SIZE_PRESETS]?.[0] ?? now.width);
      const height = preset === 'custom' ? (now.height ?? Math.round(now.width * 0.5625)) : null;
      return {
        ...s,
        style: {
          ...s.style,
          size: { preset, width: preset === 'auto' ? s.style.size.width : width, height },
        },
      };
    });
  });
  const custom2 = () =>
    store.set((s) => ({
      ...s,
      style: {
        ...s.style,
        size: { preset: 'custom', width: Number(w.value) || 1200, height: Number(hh.value) || 675 },
      },
    }));
  w.addEventListener('change', custom2);
  hh.addEventListener('change', custom2);
  const { el } = shell(control, h('div', { class: 'field-body' }, select, custom), id);
  return {
    id: control.id,
    el,
    focus: () => select.focus(),
    update(s) {
      const size = s.style.size;
      if (select.value !== size.preset) select.value = size.preset;
      custom.hidden = size.preset !== 'custom';
      if (size.preset === 'custom') {
        const r = resolveSize(size);
        if (document.activeElement !== w) w.value = String(r.width);
        if (document.activeElement !== hh) hh.value = String(r.height ?? '');
      }
    },
  };
}

function readonlyControl(control: Extract<Control, { type: 'readonly' }>): ControlInstance {
  const text = h('output', { class: 'readonly' });
  const { el } = shell(control, h('div', { class: 'field-body' }, text), null);
  return {
    id: control.id,
    el,
    focus: () => undefined,
    update: (s) => (text.textContent = control.text(s)),
  };
}

// ---- Image and logo pickers ----------------------------------------------------------------------

interface Thumb {
  key: string;
  src: string | null;
  label: string;
  selected: boolean;
  loaded: boolean;
  pick(): void;
}

/** Candidate strip, upload, and "none": shared by the image and the logo controls. */
function pickerControl(
  control: Extract<Control, { type: 'image' | 'logo' }>,
  store: Store<AppState>,
  deps: PanelDeps,
): ControlInstance {
  const isImage = control.type === 'image';
  const name: FieldName = isImage ? 'image' : 'logo';
  const showPath = isImage ? 'style.show.image' : 'style.show.logo';
  const strip = h('div', {
    class: 'thumbs',
    role: 'listbox',
    'aria-label': `${control.label} candidates`,
  });
  const file = h('input', {
    type: 'file',
    accept: 'image/*',
    class: 'visually-hidden',
    tabindex: -1,
    'aria-label': `Upload a ${control.label.toLowerCase()}`,
  });
  file.addEventListener('change', async () => {
    const picked = file.files?.[0];
    file.value = '';
    if (picked) await (isImage ? deps.uploadImage(picked) : deps.uploadLogo(picked));
  });
  const upload = h(
    'button',
    { type: 'button', class: 'btn btn-secondary btn-sm', on: { click: () => file.click() } },
    icon('upload', 14),
    'Upload…',
  );
  const toggle = switchButton(`Show ${control.label.toLowerCase()}`, (on) =>
    store.set((s) => setPath(s, showPath, on)),
  );
  const hint = isImage
    ? h(
        'p',
        { class: 'field-help' },
        'Drop an image on the preview, or paste one. Drag the picture to move its focus.',
      )
    : null;
  const body = h(
    'div',
    { class: 'field-body' },
    strip,
    h('div', { class: 'picker-actions' }, upload, file),
    hint,
  );
  const { el } = shell(control, body, null, [toggle]);

  let signature = '';
  const thumbs = (s: AppState): Thumb[] => {
    const a: ArticleModel | null = s.article;
    if (!a) return [];
    const field = a.fields[name] as Field<{ objectUrl: string; ref: { url: string } }>;
    const selected = effective(field);
    const out: Thumb[] = [];
    const seen = new Set<string>();
    for (const o of field.options) {
      seen.add(o.value.ref.url);
      out.push({
        key: o.value.ref.url,
        src: o.value.objectUrl,
        label: `${control.label} from ${sourceLabel(o.source, o.note, 'other')}`,
        selected: selected?.objectUrl === o.value.objectUrl,
        loaded: true,
        pick: () => store.set((st) => setOverride(st, name, o.value)),
      });
    }
    if (selected && !seen.has(selected.ref.url)) {
      out.unshift({
        key: selected.objectUrl,
        src: selected.objectUrl,
        label: `Your ${control.label.toLowerCase()}`,
        selected: true,
        loaded: true,
        pick: () => undefined,
      });
    }
    const candidates = isImage ? a.imageCandidates : a.logoCandidates;
    candidates.forEach((c, i) => {
      if (seen.has(c.value.url)) return;
      out.push({
        key: `c:${c.value.url}`,
        src: null,
        label: `Load ${control.label.toLowerCase()} from ${sourceLabel(c.source, c.note, 'other')}`,
        selected: false,
        loaded: false,
        pick: () => void (isImage ? deps.loadImageCandidate(i) : deps.loadLogoCandidate(i)),
      });
    });
    return out;
  };

  return {
    id: control.id,
    el,
    focus: () => (strip.querySelector<HTMLElement>('[aria-selected="true"]') ?? upload).focus(),
    update(s) {
      toggle.set(getPath(s, showPath) !== false);
      const items = thumbs(s);
      const sig = items.map((t) => `${t.key}:${t.selected}`).join('|');
      if (sig === signature) return;
      signature = sig;
      if (items.length === 0) {
        strip.replaceChildren(
          h(
            'p',
            { class: 'thumbs-empty' },
            s.article ? `No ${control.label.toLowerCase()} found. Upload one.` : '',
          ),
        );
        return;
      }
      strip.replaceChildren(
        ...items.map((t) =>
          h(
            'button',
            {
              type: 'button',
              role: 'option',
              class: `thumb${t.loaded ? '' : ' thumb-unloaded'}`,
              'aria-selected': String(t.selected),
              'aria-label': t.label,
              title: t.label,
              on: { click: t.pick },
            },
            t.src ? h('img', { src: t.src, alt: '', draggable: 'false' }) : icon('image', 18),
          ),
        ),
      );
    },
  };
}

export function buildControl(
  control: Control,
  store: Store<AppState>,
  deps: PanelDeps,
): ControlInstance {
  switch (control.type) {
    case 'text':
    case 'textarea':
      return textControl(control, store);
    case 'authors':
      return authorsControl(control, store);
    case 'date':
      return dateControl(control, store);
    case 'toggle':
      return toggleControl(control, store);
    case 'select':
      return selectControl(control, store);
    case 'segmented':
      return segmentedControl(control, store);
    case 'slider':
      return sliderControl(control, store);
    case 'swatches':
      return swatchesControl(control, store);
    case 'size':
      return sizeControl(control, store);
    case 'image':
    case 'logo':
      return pickerControl(control, store, deps);
    case 'readonly':
      return readonlyControl(control);
  }
}
