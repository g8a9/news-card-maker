import { afterEach, describe, expect, it, vi } from 'vitest';
import { OUTLETS } from '../../src/state/defaults.ts';
import { bookmarkletDialog } from '../../src/ui/dialogs/bookmarklet.ts';
import { manualDialog } from '../../src/ui/dialogs/manual.ts';
import {
  pasteSourceDialog,
  readSourceFile,
  type SourceFile,
} from '../../src/ui/dialogs/paste-source.ts';
import { installFileDrop, isHtmlFile } from '../../src/ui/file-drop.ts';

const PAGE =
  '<!doctype html><html><head><title>Story</title><link rel="canonical" href="https://news.example/story"></head><body></body></html>';

afterEach(() => {
  document.body.replaceChildren();
});

const mount = (body: HTMLElement) => {
  document.body.append(body);
  return body;
};
const submitForm = (body: HTMLElement) =>
  body.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
const type = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
const alertText = (body: HTMLElement) => body.querySelector('[role="alert"]')?.textContent ?? '';

describe('bookmarkletDialog', () => {
  it('offers a draggable javascript: link that carries this app address', () => {
    const { body } = bookmarkletDialog({
      appUrl: 'https://owner.github.io/news-card-maker/',
      copyText: async () => true,
    });
    mount(body);
    const link = body.querySelector<HTMLAnchorElement>('a.bookmarklet-link');
    const href = link?.getAttribute('href') ?? '';
    expect(href.startsWith('javascript:void(')).toBe(true);
    expect(decodeURI(href)).toContain('https://owner.github.io/news-card-maker/#bm=');
    expect(link?.textContent).toBe('Make news card');
    expect(body.querySelectorAll('ol li')).toHaveLength(3);
  });

  it('does not run when clicked in the page, and says to drag it instead', () => {
    const { body } = bookmarkletDialog({
      appUrl: 'https://a.example/',
      copyText: async () => true,
    });
    mount(body);
    const link = body.querySelector<HTMLAnchorElement>('a.bookmarklet-link') as HTMLAnchorElement;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(body.querySelector('[role="status"]')?.textContent).toMatch(/drag it/i);
  });

  it('copies the code and reports whether that worked', async () => {
    const copyText = vi.fn(async () => true);
    const { body } = bookmarkletDialog({ appUrl: 'https://a.example/', copyText });
    mount(body);
    const button = [...body.querySelectorAll('button')].find((b) => b.textContent === 'Copy code');
    button?.click();
    await vi.waitFor(() =>
      expect(body.querySelector('[role="status"]')?.textContent).toMatch(/copied/i),
    );
    expect(copyText).toHaveBeenCalledWith(expect.stringMatching(/^javascript:void\(/));

    const failing = bookmarkletDialog({
      appUrl: 'https://a.example/',
      copyText: async () => false,
    });
    mount(failing.body);
    [...failing.body.querySelectorAll('button')]
      .find((b) => b.textContent === 'Copy code')
      ?.click();
    await vi.waitFor(() =>
      expect(failing.body.querySelector('[role="status"]')?.textContent).toMatch(/would not copy/i),
    );
  });
});

describe('pasteSourceDialog', () => {
  const open = (extra: Partial<Parameters<typeof pasteSourceDialog>[0]> = {}) => {
    const submit = vi.fn();
    const { body } = pasteSourceDialog({ initialUrl: '', submit, ...extra });
    mount(body);
    const url = body.querySelector<HTMLInputElement>('#source-url') as HTMLInputElement;
    const area = body.querySelector<HTMLTextAreaElement>('#source-text') as HTMLTextAreaElement;
    return { body, submit, url, area };
  };

  it('asks for the source first', () => {
    const { body, submit } = open();
    submitForm(body);
    expect(alertText(body)).toBe('Paste the page source first.');
    expect(submit).not.toHaveBeenCalled();
  });

  it('refuses text that is not page source', () => {
    const { body, submit, area } = open();
    type(area, 'https://news.example/story');
    submitForm(body);
    expect(alertText(body)).toMatch(/does not look like page source/);
    expect(submit).not.toHaveBeenCalled();
  });

  it('submits the source with the address that was typed, normalised', () => {
    const { body, submit, url, area } = open();
    type(url, 'news.example/story?utm_source=x');
    type(area, PAGE);
    submitForm(body);
    expect(submit).toHaveBeenCalledWith(
      PAGE,
      expect.stringContaining('https://news.example/story'),
    );
    expect(alertText(body)).toBe('');
  });

  it('prefills the address it was given', () => {
    const { url } = open({ initialUrl: 'https://news.example/blocked' });
    expect(url.value).toBe('https://news.example/blocked');
  });

  it('finds the address in the page when none is typed', () => {
    const { body, submit, area } = open();
    type(area, PAGE);
    submitForm(body);
    expect(submit).toHaveBeenCalledWith(PAGE, 'https://news.example/story');
  });

  it('asks for the address when neither the field nor the page has one', () => {
    const { body, submit, area, url } = open();
    type(area, PAGE.replace(/<link[^>]*>/, ''));
    submitForm(body);
    expect(alertText(body)).toMatch(/page address/i);
    expect(document.activeElement).toBe(url);
    expect(submit).not.toHaveBeenCalled();
  });

  it('refuses a typed address that is not a link', () => {
    const { body, submit, area, url } = open();
    type(url, 'ftp://x.example/a');
    type(area, PAGE);
    submitForm(body);
    expect(alertText(body)).toMatch(/starting with https/);
    expect(submit).not.toHaveBeenCalled();
  });

  it('shows a dropped file instead of its text, and Remove brings the box back', () => {
    const file: SourceFile = { name: 'saved-page.html', text: PAGE };
    const { body, submit, area } = open({ initialFile: file });
    expect(area.hidden).toBe(true);
    expect(body.querySelector('.file-row')?.textContent).toContain('saved-page.html');
    submitForm(body);
    expect(submit).toHaveBeenCalledWith(PAGE, 'https://news.example/story');

    [...body.querySelectorAll('button')].find((b) => b.textContent === 'Remove')?.click();
    expect(area.hidden).toBe(false);
    expect(body.querySelector('.file-row')?.hasAttribute('hidden')).toBe(true);
  });

  it('takes a file chosen with the picker', async () => {
    const { body, submit } = open();
    const picker = body.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement;
    const file = new File([PAGE], 'chosen.html', { type: 'text/html' });
    Object.defineProperty(picker, 'files', { value: [file], configurable: true });
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() =>
      expect(body.querySelector('.file-row')?.textContent).toContain('chosen.html'),
    );
    submitForm(body);
    expect(submit).toHaveBeenCalledWith(PAGE, 'https://news.example/story');
  });
});

describe('readSourceFile', () => {
  it('reads a saved page and honours the charset it declares', async () => {
    const latin1 = new Uint8Array([
      ...new TextEncoder().encode('<html><head><meta charset="iso-8859-1"><title>Citt'),
      0xe0, // à in Latin-1
      ...new TextEncoder().encode('</title></head></html>'),
    ]);
    const file = new File([latin1], 'it.html', { type: 'text/html' });
    const read = await readSourceFile(file);
    expect(read.name).toBe('it.html');
    expect(read.text).toContain('Città');
  });

  it('refuses a file that is not a web page', async () => {
    await expect(readSourceFile(new File(['just some notes'], 'notes.html'))).rejects.toThrow(
      /does not look like a saved web page/,
    );
  });
});

describe('manualDialog', () => {
  const open = (prefill: Parameters<typeof manualDialog>[0]['prefill'] = {}) => {
    const submit = vi.fn();
    const { body } = manualDialog({ outlets: OUTLETS, prefill, submit });
    mount(body);
    const q = <T extends HTMLElement>(id: string) => body.querySelector<T>(`#${id}`) as T;
    return {
      body,
      submit,
      outlet: q<HTMLSelectElement>('manual-outlet'),
      site: q<HTMLInputElement>('manual-site'),
      title: q<HTMLTextAreaElement>('manual-title'),
      description: q<HTMLTextAreaElement>('manual-description'),
      date: q<HTMLInputElement>('manual-date'),
      url: q<HTMLInputElement>('manual-url'),
    };
  };

  it('lists the registry outlets by name', () => {
    const { outlet } = open();
    const names = [...outlet.options].map((o) => o.textContent);
    expect(names[0]).toBe('Other outlet');
    expect(names).toEqual(expect.arrayContaining(['The Guardian', 'The Economist', 'BBC News']));
    expect(names.slice(1)).toEqual(
      [...names.slice(1)].sort((a, b) => (a ?? '').localeCompare(b ?? '')),
    );
  });

  it('needs a headline', () => {
    const { body, submit } = open();
    submitForm(body);
    expect(alertText(body)).toBe('Add a headline.');
    expect(submit).not.toHaveBeenCalled();
  });

  it('submits a registry outlet with the typed fields', () => {
    const { body, submit, outlet, title, description, date, url } = open();
    type(outlet, 'guardian');
    type(title, '  A headline  ');
    type(description, 'A deck');
    type(date, '2026-11-05');
    type(url, 'https://www.theguardian.com/a');
    submitForm(body);
    expect(submit).toHaveBeenCalledWith({
      title: 'A headline',
      description: 'A deck',
      outletId: 'guardian',
      siteName: undefined,
      url: 'https://www.theguardian.com/a',
      date: '2026-11-05',
    });
  });

  it('takes a typed outlet name only while "Other outlet" is selected', () => {
    const { body, submit, outlet, site, title } = open();
    expect(site.hidden).toBe(false);
    type(site, 'Radio Locale');
    type(title, 'A headline');
    submitForm(body);
    expect(submit).toHaveBeenLastCalledWith(
      expect.objectContaining({ outletId: null, siteName: 'Radio Locale' }),
    );

    type(outlet, 'bbc');
    expect(site.hidden).toBe(true);
    submitForm(body);
    expect(submit).toHaveBeenLastCalledWith(
      expect.objectContaining({ outletId: 'bbc', siteName: undefined }),
    );
  });

  it('leaves the link, subtitle and date out when they are empty', () => {
    const { body, submit, title } = open();
    type(title, 'A headline');
    submitForm(body);
    expect(submit).toHaveBeenCalledWith({
      title: 'A headline',
      description: undefined,
      outletId: null,
      siteName: undefined,
      url: undefined,
      date: undefined,
    });
  });

  it('refuses a link that is not http(s)', () => {
    const { body, submit, title, url } = open();
    type(title, 'A headline');
    type(url, 'ftp://x.example/a');
    submitForm(body);
    expect(alertText(body)).toMatch(/starting with https/);
    expect(submit).not.toHaveBeenCalled();
  });

  it('starts from what was found on the page', () => {
    const { outlet, site, title, description, date, url } = open({
      title: 'Found headline',
      description: 'Found deck',
      outletId: 'bbc',
      siteName: 'BBC News',
      url: 'https://www.bbc.com/news/a',
      date: '2026-11-04',
    });
    expect(title.value).toBe('Found headline');
    expect(description.value).toBe('Found deck');
    expect(outlet.value).toBe('bbc');
    expect(site.hidden).toBe(true);
    expect(date.value).toBe('2026-11-04');
    expect(url.value).toBe('https://www.bbc.com/news/a');
  });
});

describe('installFileDrop', () => {
  const dropEvent = (files: File[], type = 'drop') => {
    const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files } });
    return event;
  };
  const handlers = (editing = true) => ({
    dropHtml: vi.fn(),
    dropImage: vi.fn(),
    rejected: vi.fn(),
    editing: () => editing,
  });

  it('recognises saved pages by name or type', () => {
    expect(isHtmlFile(new File([''], 'a.html'))).toBe(true);
    expect(isHtmlFile(new File([''], 'a.HTM'))).toBe(true);
    expect(isHtmlFile(new File([''], 'a.xhtml'))).toBe(true);
    expect(isHtmlFile(new File([''], 'noext', { type: 'text/html' }))).toBe(true);
    expect(isHtmlFile(new File([''], 'a.png', { type: 'image/png' }))).toBe(false);
  });

  it('sends a dropped .html file to the page-source flow and keeps the browser from opening it', () => {
    const on = handlers();
    const off = installFileDrop(on);
    const over = dropEvent([], 'dragover');
    document.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);

    const drop = dropEvent([new File([PAGE], 'saved.html', { type: 'text/html' })]);
    document.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(on.dropHtml).toHaveBeenCalledTimes(1);
    expect(on.dropImage).not.toHaveBeenCalled();
    off();
  });

  it('sends an image to the card only when there is one, and rejects other files', () => {
    const png = new File(['x'], 'a.png', { type: 'image/png' });
    const on = handlers(true);
    const off = installFileDrop(on);
    document.dispatchEvent(dropEvent([png]));
    expect(on.dropImage).toHaveBeenCalledWith(png);
    document.dispatchEvent(dropEvent([new File(['x'], 'notes.txt', { type: 'text/plain' })]));
    expect(on.rejected).toHaveBeenCalledTimes(1);
    off();

    const idle = handlers(false);
    const offIdle = installFileDrop(idle);
    document.dispatchEvent(dropEvent([png]));
    expect(idle.dropImage).not.toHaveBeenCalled();
    expect(idle.rejected).toHaveBeenCalledTimes(1);
    offIdle();
  });

  it('leaves drops that something else already handled', () => {
    const on = handlers();
    const off = installFileDrop(on);
    const drop = dropEvent([new File([PAGE], 'saved.html')]);
    drop.preventDefault();
    document.dispatchEvent(drop);
    expect(on.dropHtml).not.toHaveBeenCalled();
    off();
  });

  it('stops listening when removed', () => {
    const on = handlers();
    installFileDrop(on)();
    document.dispatchEvent(dropEvent([new File([PAGE], 'saved.html')]));
    expect(on.dropHtml).not.toHaveBeenCalled();
  });
});
