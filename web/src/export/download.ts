import { h } from '../render/h.ts';

/** Saves a blob through an <a download> and an object URL that is revoked afterwards. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: name, rel: 'noopener', style: { display: 'none' } });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15_000);
}

/** The Web Share sheet with files (mobile browsers), when the browser can share this file. */
export function canShareFile(file: File): boolean {
  return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
}
