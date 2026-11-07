import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installShortcuts, isField, type ShortcutHandlers } from '../../src/ui/shortcuts.ts';

let off: () => void;
let on: ShortcutHandlers;
let editing = true;

beforeEach(() => {
  editing = true;
  on = {
    focusUrl: vi.fn(),
    openHelp: vi.fn(),
    copy: vi.fn(),
    download: vi.fn(),
    submit: vi.fn(),
    uploadImage: vi.fn(),
    editing: () => editing,
  };
  off = installShortcuts(on);
  document.body.replaceChildren();
});
afterEach(() => off());

const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

const paste = (
  data: Record<string, string>,
  files: File[] = [],
  target: EventTarget = document.body,
) => {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: { files, getData: (type: string) => data[type] ?? '' },
  });
  target.dispatchEvent(event);
  return event;
};

describe('keyboard shortcuts (PLAN.md §9.6)', () => {
  it('"/" and Ctrl/⌘ L focus the link field', () => {
    expect(press('/').defaultPrevented).toBe(true);
    press('l', { ctrlKey: true });
    press('L', { metaKey: true });
    expect(on.focusUrl).toHaveBeenCalledTimes(3);
  });

  it('"?" opens help', () => {
    press('?', { shiftKey: true });
    expect(on.openHelp).toHaveBeenCalledTimes(1);
  });

  it('Ctrl/⌘ S downloads, only while editing', () => {
    expect(press('s', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(on.download).toHaveBeenCalledTimes(1);
    editing = false;
    expect(press('s', { metaKey: true }).defaultPrevented).toBe(false);
    expect(on.download).toHaveBeenCalledTimes(1);
  });

  it('Ctrl/⌘ C copies the card when no text is selected', () => {
    press('c', { ctrlKey: true });
    expect(on.copy).toHaveBeenCalledTimes(1);
  });

  it('leaves copy alone when text is selected', () => {
    const p = document.createElement('p');
    p.textContent = 'some selected text';
    document.body.append(p);
    const range = document.createRange();
    range.selectNodeContents(p);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    expect(press('c', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(on.copy).not.toHaveBeenCalled();
    window.getSelection()?.removeAllRanges();
  });

  it('does not steal keys from text fields', () => {
    const input = document.createElement('input');
    const area = document.createElement('textarea');
    const select = document.createElement('select');
    document.body.append(input, area, select);
    for (const field of [input, area, select]) {
      expect(isField(field)).toBe(true);
      expect(press('/', {}, field).defaultPrevented).toBe(false);
      expect(press('?', {}, field).defaultPrevented).toBe(false);
      expect(press('c', { ctrlKey: true }, field).defaultPrevented).toBe(false);
    }
    expect(on.focusUrl).not.toHaveBeenCalled();
    expect(on.openHelp).not.toHaveBeenCalled();
    expect(on.copy).not.toHaveBeenCalled();
    // Ctrl/⌘ L still works from a field: it is a browser-level "go to the address" gesture.
    press('l', { ctrlKey: true }, input);
    expect(on.focusUrl).toHaveBeenCalledTimes(1);
  });

  it('pasting a link anywhere submits it', () => {
    const event = paste({ 'text/plain': 'Look at this https://example.com/story?id=3 please' });
    expect(event.defaultPrevented).toBe(true);
    expect(on.submit).toHaveBeenCalledWith('Look at this https://example.com/story?id=3 please');
  });

  it('ignores pasted text that is not a link, and pastes into fields', () => {
    expect(paste({ 'text/plain': 'just words' }).defaultPrevented).toBe(false);
    const input = document.createElement('input');
    document.body.append(input);
    expect(paste({ 'text/plain': 'https://example.com/a' }, [], input).defaultPrevented).toBe(
      false,
    );
    expect(on.submit).not.toHaveBeenCalled();
  });

  it('pasting an image uploads it while editing', () => {
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    paste({}, [file]);
    expect(on.uploadImage).toHaveBeenCalledWith(file);
    editing = false;
    paste({}, [file]);
    expect(on.uploadImage).toHaveBeenCalledTimes(1);
  });

  it('stops listening when uninstalled', () => {
    off();
    press('/');
    expect(on.focusUrl).not.toHaveBeenCalled();
    off = installShortcuts(on);
  });
});
