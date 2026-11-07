// Turns an upstream response into the proxy's response (PLAN.md §4.1): byte caps, type checks,
// and the metadata headers. Bodies are never parsed or decoded here.
import { ProxyError } from './errors.ts';
import {
  IMAGE_MIME,
  imageHeaderPlausible,
  isAllowedTextType,
  looksLikeText,
  sniffImage,
} from './sniff.ts';
import { mapFetchError, type UpstreamResult } from './upstream.ts';

export const DEFAULT_MAX_TEXT_BYTES = 3_000_000;
export const DEFAULT_MAX_IMAGE_BYTES = 15_000_000;

const SNIFF_BYTES = 1024;

export function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function concat(chunks: Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Header values must be single-line printable text. */
const cleanHeader = (value: string): string => value.replace(/[^\x20-\x7e]/g, '').slice(0, 200);

/** Buffers the body up to `max` bytes, then cancels the upstream stream. */
async function readUpTo(
  body: ReadableStream<Uint8Array> | null,
  max: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > max) {
        chunks.push(value.subarray(0, max - total));
        total = max;
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch (e) {
    throw mapFetchError(e);
  }
  return { bytes: concat(chunks, total), truncated };
}

export async function textResponse(
  up: UpstreamResult,
  maxBytes: number,
  startedAt: number,
): Promise<Response> {
  const { response, finalUrl, redirectCount } = up;
  const contentType = response.headers.get('Content-Type');
  const { bytes, truncated } = await readUpTo(response.body, maxBytes);

  const typeOk = contentType ? isAllowedTextType(contentType) : looksLikeText(bytes);
  if (!typeOk) throw new ProxyError('NOT_TEXT', 'The page is not HTML, XML or JSON');

  const headers = new Headers({
    'Content-Type': 'text/plain',
    'X-Upstream-Status': String(response.status),
    'X-Upstream-Content-Type': cleanHeader(contentType ?? ''),
    'X-Final-Url': finalUrl.href,
    'X-Redirect-Count': String(redirectCount),
    'X-Truncated': truncated ? '1' : '0',
    'X-Fetch-Ms': String(Math.max(0, Date.now() - startedAt)),
    'Cache-Control': response.status === 200 ? 'public, max-age=600' : 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  return new Response(bytes, { status: 200, headers });
}

export async function imageResponse(up: UpstreamResult, maxBytes: number): Promise<Response> {
  const { response, finalUrl } = up;
  const discard = () => response.body?.cancel().catch(() => {});

  if (response.status < 200 || response.status > 299) {
    await discard();
    throw new ProxyError('UPSTREAM_HTTP_ERROR', `The image server answered ${response.status}`, {
      'X-Upstream-Status': String(response.status),
    });
  }
  const declared = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discard();
    throw new ProxyError('IMAGE_TOO_LARGE', 'The image is too large');
  }
  if (!response.body) throw new ProxyError('NOT_IMAGE', 'The response is not an image');

  const reader = response.body.getReader();
  const headChunks: Uint8Array[] = [];
  let headLength = 0;
  let finished = false;
  try {
    while (headLength < SNIFF_BYTES && !finished) {
      const r = await reader.read();
      if (r.done) finished = true;
      else {
        headChunks.push(r.value);
        headLength += r.value.byteLength;
      }
    }
  } catch (e) {
    throw mapFetchError(e);
  }
  const head = concat(headChunks, headLength);

  const type = sniffImage(head);
  if (!type || !imageHeaderPlausible(response.headers.get('Content-Type'))) {
    await reader.cancel().catch(() => {});
    throw new ProxyError('NOT_IMAGE', 'The response is not a supported image');
  }
  if (headLength > maxBytes) {
    await reader.cancel().catch(() => {});
    throw new ProxyError('IMAGE_TOO_LARGE', 'The image is too large');
  }

  // Images are never truncated: if the stream outgrows the cap the body errors out instead.
  let total = headLength;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(head);
      if (finished) controller.close();
    },
    async pull(controller) {
      try {
        const r = await reader.read();
        if (r.done) return controller.close();
        total += r.value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          return controller.error(new ProxyError('IMAGE_TOO_LARGE', 'The image is too large'));
        }
        controller.enqueue(r.value);
      } catch (e) {
        controller.error(e);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  const headers = new Headers({
    'Content-Type': IMAGE_MIME[type],
    'Cache-Control': 'public, max-age=86400',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Upstream-Status': String(response.status),
    'X-Final-Url': finalUrl.href,
  });
  // An SVG opened directly (not through <img>) must be inert.
  if (type === 'svg') {
    headers.set(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
  }
  return new Response(body, { status: 200, headers });
}
