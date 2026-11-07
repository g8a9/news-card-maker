// Decoding fetched bytes (PLAN.md §5.2). Never `Response.text()`: it always decodes as UTF-8, and
// some outlets are not UTF-8 (Corriere della Sera serves ISO-8859-1).

export interface Decoded {
  text: string;
  charset: string;
}

type Kind = 'html' | 'xml' | 'json';

function kindOf(contentType: string, head: string): Kind {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (type.includes('json')) return 'json';
  if (type.includes('xml') && !type.includes('xhtml')) return 'xml';
  if (type.includes('html') || type.includes('xhtml')) return 'html';
  const first = head.trimStart()[0];
  if (first === '{' || first === '[') return 'json';
  return /^\s*<\?xml|^\s*<(rss|feed|rdf)\b/i.test(head) ? 'xml' : 'html';
}

const CHARSET_IN_HEADER = /charset\s*=\s*["']?\s*([A-Za-z0-9_.:-]+)/i;
const META_CHARSET = /<meta\s+[^>]*?charset\s*=\s*["']?\s*([A-Za-z0-9_.:-]+)/i;
const XML_ENCODING = /^\s*<\?xml[^>]*?encoding\s*=\s*["']([A-Za-z0-9_.:-]+)["']/i;

function bomCharset(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return null;
}

/** First 4096 bytes as ASCII, enough to find a `<meta charset>` or an XML declaration. */
function asciiHead(bytes: Uint8Array, length = 4096): string {
  let out = '';
  const n = Math.min(bytes.length, length);
  for (let i = 0; i < n; i++) out += String.fromCharCode((bytes[i] as number) & 0x7f);
  return out;
}

function makeDecoder(label: string): TextDecoder | null {
  try {
    return new TextDecoder(label);
  } catch {
    return null;
  }
}

/**
 * Charset precedence: BOM, then `charset=` in the upstream Content-Type, then (HTML) a meta tag or
 * (XML) the XML declaration within the first 4096 bytes, then UTF-8. Unknown labels fall back to UTF-8.
 */
export function decodeBytes(bytes: Uint8Array, upstreamContentType: string | null): Decoded {
  const head = asciiHead(bytes);
  const kind = kindOf(upstreamContentType ?? '', head);

  const candidates: string[] = [];
  const bom = bomCharset(bytes);
  if (bom) candidates.push(bom);
  const fromHeader = CHARSET_IN_HEADER.exec(upstreamContentType ?? '')?.[1];
  if (fromHeader) candidates.push(fromHeader);
  if (kind === 'html') {
    const fromMeta = META_CHARSET.exec(head)?.[1];
    if (fromMeta) candidates.push(fromMeta);
  } else if (kind === 'xml') {
    const fromDeclaration = XML_ENCODING.exec(head)?.[1];
    if (fromDeclaration) candidates.push(fromDeclaration);
  }

  for (const label of candidates) {
    // The HTML spec treats a meta-declared UTF-16 as UTF-8 (the bytes were clearly ASCII-compatible).
    const effective = /^utf-?16/i.test(label) && !bom ? 'utf-8' : label;
    const decoder = makeDecoder(effective);
    if (decoder) return { text: decoder.decode(bytes), charset: decoder.encoding };
  }
  const utf8 = new TextDecoder('utf-8');
  return { text: utf8.decode(bytes), charset: 'utf-8' };
}
