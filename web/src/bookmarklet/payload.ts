// The bookmarklet's payload (PLAN.md §11): { v: 1, url, html } as JSON, compressed with deflate-raw and
// written as base64url, so it fits in a URL fragment (which never reaches any server).

export interface Payload {
  v: 1;
  url: string;
  html: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export async function encodePayload(payload: Payload): Promise<string> {
  const stream = new Blob([JSON.stringify(payload)])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return toBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()));
}

export const MAX_DECODED_BYTES = 2_000_000;

/** Decodes and validates a payload. Refuses anything that inflates beyond `maxBytes` or is not http(s). */
export async function decodePayload(text: string, maxBytes = MAX_DECODED_BYTES): Promise<Payload> {
  let compressed: Uint8Array;
  try {
    compressed = fromBase64Url(text);
  } catch {
    throw new Error('The bookmarklet data is not valid');
  }
  const stream = new Blob([compressed as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('The bookmarklet data is too large');
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('too large')) throw e;
    throw new Error('The bookmarklet data is not valid');
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let data: Partial<Payload>;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('The bookmarklet data is not valid');
  }
  if (data.v !== 1 || typeof data.url !== 'string' || typeof data.html !== 'string') {
    throw new Error('The bookmarklet data is not valid');
  }
  let parsed: URL;
  try {
    parsed = new URL(data.url);
  } catch {
    throw new Error('The bookmarklet data is not valid');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('The bookmarklet data is not valid');
  }
  return { v: 1, url: parsed.href, html: data.html };
}
