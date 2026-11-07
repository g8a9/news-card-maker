// Content-type allowlists and magic-byte sniffing (PLAN.md §4.1). Sniffs at most the first 1 KB.

export type ImageType = 'jpeg' | 'png' | 'gif' | 'webp' | 'avif' | 'ico' | 'bmp' | 'svg';

export const IMAGE_MIME: Record<ImageType, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

const TEXT_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'text/xml',
  'application/xml',
  'application/rss+xml',
  'application/atom+xml',
  'application/rdf+xml',
  'application/json',
  'application/ld+json',
  'application/manifest+json',
  'application/json+oembed',
  'text/plain',
]);

/** `Content-Type` without parameters, lower-cased. Empty when the header is missing. */
export function mimeOf(contentType: string | null | undefined): string {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

export function isAllowedTextType(contentType: string | null | undefined): boolean {
  return TEXT_TYPES.has(mimeOf(contentType));
}

/** For responses without a content type: the first non-whitespace byte must be `<` or `{`. */
export function looksLikeText(bytes: Uint8Array): boolean {
  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3; // UTF-8 BOM
  for (; i < bytes.length && i < 1024; i++) {
    const b = bytes[i] as number;
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) continue;
    return b === 0x3c || b === 0x7b;
  }
  return false;
}

const startsWith = (b: Uint8Array, sig: number[], offset = 0): boolean =>
  b.length >= offset + sig.length && sig.every((v, i) => b[offset + i] === v);

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/** `<svg` within the first KB, after an optional BOM, whitespace, XML declaration, comments, doctype. */
function looksLikeSvg(bytes: Uint8Array): boolean {
  let text = '';
  const n = Math.min(bytes.length, 1024);
  for (let i = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0; i < n; i++) {
    text += String.fromCharCode(bytes[i] as number);
  }
  let pos = 0;
  for (;;) {
    while (pos < text.length && /\s/.test(text[pos] as string)) pos++;
    if (text.startsWith('<?xml', pos)) {
      const end = text.indexOf('?>', pos);
      if (end < 0) return false;
      pos = end + 2;
    } else if (text.startsWith('<!--', pos)) {
      const end = text.indexOf('-->', pos);
      if (end < 0) return false;
      pos = end + 3;
    } else if (/^<!doctype/i.test(text.slice(pos, pos + 9))) {
      const end = text.indexOf('>', pos);
      if (end < 0 || text.slice(pos, end).includes('[')) return false; // no internal subset
      pos = end + 1;
    } else {
      break;
    }
  }
  return /^<svg[\s/>]/i.test(text.slice(pos, pos + 6));
}

export function sniffImage(b: Uint8Array): ImageType | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (startsWith(b, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8)) return 'webp';
  if (startsWith(b, ascii('ftypavif'), 4) || startsWith(b, ascii('ftypavis'), 4)) return 'avif';
  if (startsWith(b, [0x00, 0x00, 0x01, 0x00])) return 'ico';
  if (startsWith(b, [0x42, 0x4d]) && (b.length < 10 || startsWith(b, [0, 0, 0, 0], 6)))
    return 'bmp';
  if (looksLikeSvg(b)) return 'svg';
  return null;
}

/** Image content types we accept alongside the magic bytes: any image/*, or a generic binary type. */
export function imageHeaderPlausible(contentType: string | null | undefined): boolean {
  const mime = mimeOf(contentType);
  return (
    mime === '' ||
    mime.startsWith('image/') ||
    mime === 'application/octet-stream' ||
    mime === 'binary/octet-stream'
  );
}
