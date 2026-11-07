// Files dropped anywhere on the page (PLAN.md §9.2): a saved web page becomes a card source, an image
// replaces the card's image. Without this the browser would navigate to the dropped file and the card
// would be lost.
export interface FileDropHandlers {
  dropHtml(file: File): void;
  dropImage(file: File): void;
  editing(): boolean;
  /** A file we cannot use. */
  rejected(): void;
}

const hasFiles = (event: DragEvent): boolean =>
  [...(event.dataTransfer?.types ?? [])].includes('Files');

export const isHtmlFile = (file: File): boolean =>
  /\.(x?html?)$/i.test(file.name) ||
  file.type === 'text/html' ||
  file.type === 'application/xhtml+xml';

export function installFileDrop(on: FileDropHandlers): () => void {
  const onDragOver = (event: DragEvent) => {
    if (hasFiles(event)) event.preventDefault();
  };
  const onDrop = (event: DragEvent) => {
    // The stage and the dialogs handle their own drops and say so by preventing the default.
    if (event.defaultPrevented || !hasFiles(event)) return;
    event.preventDefault();
    const files = [...(event.dataTransfer?.files ?? [])];
    const html = files.find(isHtmlFile);
    if (html) return on.dropHtml(html);
    const image = files.find((f) => f.type.startsWith('image/'));
    if (image && on.editing()) return on.dropImage(image);
    on.rejected();
  };
  document.addEventListener('dragover', onDragOver);
  document.addEventListener('drop', onDrop);
  return () => {
    document.removeEventListener('dragover', onDragOver);
    document.removeEventListener('drop', onDrop);
  };
}
