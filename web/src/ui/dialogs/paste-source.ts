// Paste page source (PLAN.md §9.2, §9.5): for pages we cannot fetch, the reader's own browser has the
// source. It can be pasted, or a saved .html file can be chosen or dropped. Everything is read here, in
// the browser; only image and logo addresses go to the fetch service afterwards.
import { decodeBytes } from '../../core/charset.ts';
import { guessPageUrl, looksLikeHtml, MAX_SOURCE_CHARS } from '../../core/source.ts';
import { normalizeInput } from '../../core/url.ts';
import { h } from '../../render/h.ts';
import type { DialogContent } from './host.ts';

export interface SourceFile {
  name: string;
  text: string;
}

export interface PasteSourceDeps {
  /** The address to prefill: the link that was just tried, if any. */
  initialUrl: string;
  /** A file that was dropped on the page before the dialog opened. */
  initialFile?: SourceFile | null;
  submit(html: string, url: string): void;
}

/** Reads a saved page, honouring the charset the page declares. */
export async function readSourceFile(file: File): Promise<SourceFile> {
  if (file.size > MAX_SOURCE_CHARS * 2) throw new Error('That file is too large to be a web page.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { text } = decodeBytes(bytes, null);
  if (text.length > MAX_SOURCE_CHARS) throw new Error('That file is too large to be a web page.');
  if (!looksLikeHtml(text)) throw new Error('That file does not look like a saved web page.');
  return { name: file.name, text };
}

const kilobytes = (chars: number) =>
  chars > 999_999
    ? `${(chars / 1e6).toFixed(1)} MB`
    : `${Math.max(1, Math.round(chars / 1000))} KB`;

export function pasteSourceDialog(deps: PasteSourceDeps): DialogContent {
  let file: SourceFile | null = deps.initialFile ?? null;

  const urlInput = h('input', {
    id: 'source-url',
    class: 'input',
    type: 'text',
    inputmode: 'url',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'https://…',
    value: deps.initialUrl,
  });
  const area = h('textarea', {
    id: 'source-text',
    class: 'input source-area',
    rows: 7,
    spellcheck: 'false',
    autocomplete: 'off',
    wrap: 'off',
    autofocus: true,
    placeholder: '<!doctype html> …',
  });
  const fileRow = h('div', { class: 'file-row' });
  const error = h('p', { class: 'dialog-error', role: 'alert' });
  const picker = h('input', {
    type: 'file',
    accept: '.html,.htm,.xhtml,text/html',
    hidden: true,
    'aria-label': 'Saved page',
  });

  const showFile = () => {
    area.hidden = file !== null;
    fileRow.hidden = file === null;
    fileRow.replaceChildren(
      ...(file
        ? [
            h('span', { class: 'file-name' }, `${file.name} · ${kilobytes(file.text.length)}`),
            h(
              'button',
              {
                type: 'button',
                class: 'link-btn',
                on: {
                  click: () => {
                    file = null;
                    showFile();
                    area.focus();
                  },
                },
              },
              'Remove',
            ),
          ]
        : []),
    );
  };

  const useFile = async (candidate: File) => {
    error.textContent = '';
    try {
      file = await readSourceFile(candidate);
      area.value = '';
      showFile();
    } catch (e) {
      error.textContent = e instanceof Error ? e.message : 'That file could not be read.';
    }
  };
  picker.addEventListener('change', () => {
    const chosen = picker.files?.[0];
    if (chosen) void useFile(chosen);
    picker.value = '';
  });
  area.addEventListener('input', () => {
    error.textContent = '';
  });

  const submit = () => {
    const html = file?.text ?? area.value;
    if (!html.trim()) {
      error.textContent = 'Paste the page source first.';
      return area.focus();
    }
    if (html.length > MAX_SOURCE_CHARS) {
      error.textContent = 'That is too large to be a web page.';
      return;
    }
    if (!looksLikeHtml(html)) {
      error.textContent =
        'That does not look like page source. Open the page, view its source, and copy all of it.';
      return area.focus();
    }
    let url: string | null = null;
    const typed = urlInput.value.trim();
    if (typed) {
      const parsed = normalizeInput(typed);
      if (!parsed.ok) {
        error.textContent = 'Enter the page address, starting with https://';
        return urlInput.focus();
      }
      url = parsed.url;
    } else {
      // The head is all that matters here; parsing a few hundred KB keeps this instant.
      const doc = new DOMParser().parseFromString(html.slice(0, 300_000), 'text/html');
      url = guessPageUrl(doc, html);
    }
    if (!url) {
      error.textContent = 'Add the page address, so the card can cite it.';
      return urlInput.focus();
    }
    deps.submit(html, url);
  };

  const body = h(
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
      'For pages that block automated readers. Open the article, view its source (Ctrl/⌘ U, or right-click and View Page Source), select everything, copy it and paste it here. A saved .html file works too: choose it, or drop it anywhere on this page.',
    ),
    h(
      'div',
      { class: 'form-field' },
      h('label', { class: 'form-label', for: 'source-url' }, 'Page address'),
      urlInput,
    ),
    h(
      'div',
      { class: 'form-field' },
      h('label', { class: 'form-label', for: 'source-text' }, 'Page source'),
      area,
      fileRow,
    ),
    error,
    h(
      'div',
      { class: 'dialog-actions dialog-actions-split' },
      h(
        'button',
        { type: 'button', class: 'btn btn-secondary', on: { click: () => picker.click() } },
        'Choose a .html file',
      ),
      picker,
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Create card'),
    ),
  );

  // Dropping a saved page onto the dialog fills it, whatever part of the dialog it lands on.
  body.addEventListener('dragover', (event) => {
    if ([...(event.dataTransfer?.types ?? [])].includes('Files')) event.preventDefault();
  });
  body.addEventListener('drop', (event) => {
    const dropped = event.dataTransfer?.files?.[0];
    if (!dropped) return;
    event.preventDefault();
    event.stopPropagation();
    void useFile(dropped);
  });

  showFile();
  return { title: 'Paste page source', wide: true, body };
}
