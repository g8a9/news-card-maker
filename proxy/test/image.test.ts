import { afterEach, describe, expect, it, vi } from 'vitest';
import { bytes, call, fileWith, imagePath, JPEG, mockUpstream, ORIGIN, PNG } from './helpers.ts';

afterEach(() => vi.restoreAllMocks());

const errorCode = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

const img = (body: Uint8Array, type: string, extra: Record<string, string> = {}) =>
  new Response(body, { headers: { 'Content-Type': type, ...extra } });

describe('GET /api/image', () => {
  it('passes the bytes through with the sniffed type and the documented headers', async () => {
    const png = fileWith(PNG, 300);
    mockUpstream(() => img(png, 'image/png'));
    const res = await call(imagePath('https://cdn.example.com/a.png'));
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
  });

  it('sends an image Accept header and the honest user agent', async () => {
    const upstream = mockUpstream(() => img(fileWith(PNG), 'image/png'));
    await call(imagePath('https://cdn.example.com/accept.png'));
    const req = new Request(upstream.mock.calls[0]?.[0] as string, upstream.mock.calls[0]?.[1]);
    expect(req.headers.get('Accept')).toContain('image/avif');
    expect(req.headers.get('User-Agent')).toContain('NewsCardMaker');
    expect(req.headers.get('Referer')).toBeNull();
  });

  it('corrects the content type from the magic bytes', async () => {
    mockUpstream(() => img(fileWith(JPEG, 200), 'application/octet-stream'));
    const res = await call(imagePath('https://cdn.example.com/mislabelled'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
  });

  it('accepts a response with no content type when the bytes are an image', async () => {
    mockUpstream(() => new Response(fileWith(PNG), { headers: {} }));
    expect((await call(imagePath('https://cdn.example.com/untyped'))).status).toBe(200);
  });

  it('sends a restrictive CSP with SVG so a direct visit is inert', async () => {
    const svg =
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
    mockUpstream(() => img(new TextEncoder().encode(svg), 'image/svg+xml'));
    const res = await call(imagePath('https://cdn.example.com/logo.svg'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(res.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
  });

  it('refuses a non-image with 415 NOT_IMAGE, whatever the header says', async () => {
    const html = new TextEncoder().encode('<!doctype html><html>not an image</html>');
    mockUpstream(() => img(html, 'image/png'));
    const lying = await call(imagePath('https://cdn.example.com/lying.png'));
    expect(lying.status).toBe(415);
    expect(await errorCode(lying)).toBe('NOT_IMAGE');

    mockUpstream(() => img(fileWith(PNG), 'text/html'));
    const wrongHeader = await call(imagePath('https://cdn.example.com/wrong-header'));
    expect(wrongHeader.status).toBe(415);

    mockUpstream(() => img(bytes(), 'image/png'));
    const empty = await call(imagePath('https://cdn.example.com/empty'));
    expect(empty.status).toBe(415);
  });

  it('refuses scripts and PDFs served as images', async () => {
    mockUpstream(() => img(new TextEncoder().encode('alert(1)'), 'image/svg+xml'));
    expect((await call(imagePath('https://cdn.example.com/script.svg'))).status).toBe(415);
    mockUpstream(() => img(new TextEncoder().encode('%PDF-1.7'), 'application/pdf'));
    expect((await call(imagePath('https://cdn.example.com/doc.pdf'))).status).toBe(415);
  });

  it('answers 502 UPSTREAM_HTTP_ERROR with X-Upstream-Status for non-2xx', async () => {
    mockUpstream(() => new Response('gone', { status: 404 }));
    const res = await call(imagePath('https://cdn.example.com/missing.png'));
    expect(res.status).toBe(502);
    expect(res.headers.get('X-Upstream-Status')).toBe('404');
    expect(await errorCode(res)).toBe('UPSTREAM_HTTP_ERROR');
  });
});

describe('image size cap', () => {
  it('rejects early when Content-Length is over the cap', async () => {
    mockUpstream(() => img(fileWith(PNG, 2000), 'image/png', { 'Content-Length': '2000' }));
    const res = await call(imagePath('https://cdn.example.com/huge.png'), {
      env: { MAX_IMAGE_BYTES: '1000' },
    });
    expect(res.status).toBe(413);
    expect(await errorCode(res)).toBe('IMAGE_TOO_LARGE');
  });

  it('serves an image that is exactly at the cap', async () => {
    mockUpstream(() => img(fileWith(PNG, 1000), 'image/png'));
    const res = await call(imagePath('https://cdn.example.com/exact.png'), {
      env: { MAX_IMAGE_BYTES: '1000' },
    });
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(1000);
  });

  it('errors the stream instead of truncating when the bytes outgrow the cap', async () => {
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        // No Content-Length: the first chunk looks fine, the later ones push past the cap.
        controller.enqueue(sent === 0 ? fileWith(PNG, 600) : new Uint8Array(600));
        sent++;
        if (sent > 5) controller.close();
      },
    });
    mockUpstream(() => new Response(stream, { headers: { 'Content-Type': 'image/png' } }));
    const res = await call(imagePath('https://cdn.example.com/endless.png'), {
      env: { MAX_IMAGE_BYTES: '3000' },
    });
    expect(res.status).toBe(200);
    await expect(res.arrayBuffer()).rejects.toThrow();
  });

  it('rejects at once when even the first KB exceeds the cap', async () => {
    mockUpstream(() => img(fileWith(PNG, 4000), 'image/png'));
    const res = await call(imagePath('https://cdn.example.com/tiny-cap.png'), {
      env: { MAX_IMAGE_BYTES: '100' },
    });
    expect(res.status).toBe(413);
  });
});
