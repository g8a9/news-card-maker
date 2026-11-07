// When the browser will not let us write to the clipboard, show the picture so it can be copied by hand.
import { h } from '../../render/h.ts';
import type { DialogContent } from './host.ts';

let held: { blob: Blob; url: string } | null = null;

export function holdFallbackBlob(blob: Blob): void {
  if (held) URL.revokeObjectURL(held.url);
  held = { blob, url: URL.createObjectURL(blob) };
}

export function copyFallbackDialog(onDownload: () => void): DialogContent {
  const url = held?.url ?? '';
  return {
    title: 'Copy the image',
    wide: true,
    body: h(
      'div',
      { class: 'dialog-body' },
      h(
        'p',
        { class: 'dialog-note' },
        "Your browser didn't allow copying automatically. Right-click the image (or press and hold it) and choose Copy Image, or download it.",
      ),
      url ? h('img', { class: 'fallback-img', src: url, alt: 'The exported card' }) : null,
      h(
        'div',
        { class: 'dialog-actions' },
        h(
          'button',
          { type: 'button', class: 'btn btn-primary', on: { click: onDownload } },
          'Download',
        ),
      ),
    ),
  };
}
