// Keyboard shortcuts (PLAN.md §9.6). Text fields keep their own keys: a shortcut only fires when no
// field is focused (and, for copy, when no text is selected).
import { normalizeInput } from '../core/url.ts';

export interface ShortcutHandlers {
  focusUrl(): void;
  openHelp(): void;
  copy(): void;
  download(): void;
  submit(text: string): void;
  uploadImage(file: File): void;
  editing(): boolean;
}

export function isField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

export function installShortcuts(on: ShortcutHandlers): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    const modal = document.querySelector('dialog[open]');
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key;
    const inField = isField(event.target);

    if (mod && !event.shiftKey && !event.altKey && key.toLowerCase() === 'l') {
      event.preventDefault();
      on.focusUrl();
    } else if (!modal && !mod && !event.altKey && key === '/' && !inField) {
      event.preventDefault();
      on.focusUrl();
    } else if (!modal && !mod && key === '?' && !inField) {
      event.preventDefault();
      on.openHelp();
    } else if (!modal && mod && !event.shiftKey && key.toLowerCase() === 's' && on.editing()) {
      event.preventDefault();
      on.download();
    } else if (
      !modal &&
      mod &&
      !event.shiftKey &&
      key.toLowerCase() === 'c' &&
      !inField &&
      on.editing()
    ) {
      if (window.getSelection()?.isCollapsed === false) return; // let the browser copy selected text
      event.preventDefault();
      on.copy();
    }
  };

  const onPaste = (event: ClipboardEvent) => {
    if (isField(event.target) || document.querySelector('dialog[open]')) return;
    const image = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (image && on.editing()) {
      event.preventDefault();
      on.uploadImage(image);
      return;
    }
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (text && normalizeInput(text).ok) {
      event.preventDefault();
      on.submit(text);
    }
  };

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('paste', onPaste);
  return () => {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('paste', onPaste);
  };
}
