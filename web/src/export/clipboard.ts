// Copying an image (PLAN.md §8.2). The ClipboardItem must be created synchronously inside the user
// gesture, with a Promise for the blob: that is what lets Safari accept an image that takes time to render.

export function canCopyImages(): boolean {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false;
  const supports = (ClipboardItem as unknown as { supports?: (type: string) => boolean }).supports;
  return supports ? supports('image/png') : true;
}

/** Call this directly from the click or key handler, before any `await`. */
export function writePng(png: Promise<Blob>): Promise<void> {
  try {
    return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  } catch (error) {
    return Promise.reject(error);
  }
}
