import { afterEach, describe, expect, it, vi } from 'vitest';
import { bytes, call, html, mockUpstream, ORIGIN, PNG, textPath } from './helpers.ts';

afterEach(() => vi.restoreAllMocks());

// A string body makes the runtime add a text/plain Content-Type; bytes leave the header unset.
const utf8 = (s: string) => new TextEncoder().encode(s);

const errorCode = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

describe('GET /api/text', () => {
  it('returns the raw upstream bytes as text/plain with the metadata headers', async () => {
    mockUpstream(() => html('<html><title>Hello</title></html>'));
    const res = await call(textPath('https://example.com/text-ok'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<html><title>Hello</title></html>');
    expect(res.headers.get('Content-Type')).toBe('text/plain');
    expect(res.headers.get('X-Upstream-Status')).toBe('200');
    expect(res.headers.get('X-Upstream-Content-Type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('X-Final-Url')).toBe('https://example.com/text-ok');
    expect(res.headers.get('X-Redirect-Count')).toBe('0');
    expect(res.headers.get('X-Truncated')).toBe('0');
    expect(Number(res.headers.get('X-Fetch-Ms'))).toBeGreaterThanOrEqual(0);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=600');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
  });

  it('exposes every X-* header to the allowed origin', async () => {
    mockUpstream(() => html('<html></html>'));
    const res = await call(textPath('https://example.com/text-cors'));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(res.headers.get('Vary')).toContain('Origin');
    const exposed = (res.headers.get('Access-Control-Expose-Headers') ?? '').split(/,\s*/);
    expect(exposed).toEqual(
      expect.arrayContaining([
        'X-Upstream-Status',
        'X-Upstream-Content-Type',
        'X-Final-Url',
        'X-Redirect-Count',
        'X-Truncated',
        'X-Fetch-Ms',
      ]),
    );
  });

  it('keeps non-UTF-8 bytes untouched so the client can decode the charset', async () => {
    const latin1 = bytes(...[...'<html><title>Citt'].map((c) => c.charCodeAt(0)), 0xe0, 0x3c, 0x2f);
    mockUpstream(
      () => new Response(latin1, { headers: { 'Content-Type': 'text/html; charset=ISO-8859-1' } }),
    );
    const res = await call(textPath('https://example.com/latin1'));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(latin1);
    expect(res.headers.get('X-Upstream-Content-Type')).toBe('text/html; charset=ISO-8859-1');
  });

  it('answers 200 for 4xx and 5xx pages so the client can recognise challenge pages', async () => {
    mockUpstream(() => html('<title>Just a moment...</title>', {}, 403));
    const res = await call(textPath('https://example.com/challenge'));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Upstream-Status')).toBe('403');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toContain('Just a moment');
  });

  it('accepts JSON, RSS and XML', async () => {
    const cases: Array<[string, string]> = [
      ['application/manifest+json', '{"name":"Outlet"}'],
      ['application/rss+xml; charset=UTF-8', '<?xml version="1.0"?><rss/>'],
      ['text/xml', '<feed/>'],
    ];
    for (const [i, [type, body]] of cases.entries()) {
      mockUpstream(() => new Response(body, { headers: { 'Content-Type': type } }));
      const res = await call(textPath(`https://example.com/typed-${i}`));
      expect(res.status, type).toBe(200);
      expect(await res.text()).toBe(body);
    }
  });

  it('sniffs a missing content type and accepts markup or JSON', async () => {
    mockUpstream(() => new Response(utf8('  <html>x</html>')));
    expect((await call(textPath('https://example.com/untyped-html'))).status).toBe(200);
    mockUpstream(() => new Response(utf8('{"a":1}')));
    expect((await call(textPath('https://example.com/untyped-json'))).status).toBe(200);
  });

  it('refuses other types with 415 NOT_TEXT', async () => {
    const attempts: Array<[string, BodyInit]> = [
      ['image/png', bytes(...PNG)],
      ['application/pdf', '%PDF-1.7'],
      ['application/octet-stream', 'MZ'],
      ['text/css', 'a{}'],
    ];
    for (const [i, [type, body]] of attempts.entries()) {
      mockUpstream(() => new Response(body, { headers: { 'Content-Type': type } }));
      const res = await call(textPath(`https://example.com/not-text-${i}`));
      expect(res.status, type).toBe(415);
      expect(await errorCode(res)).toBe('NOT_TEXT');
    }
    mockUpstream(() => new Response(utf8('plain words')));
    expect((await call(textPath('https://example.com/untyped-words'))).status).toBe(415);
  });

  it('truncates at MAX_TEXT_BYTES and says so', async () => {
    const big = `<html>${'a'.repeat(5000)}</html>`;
    mockUpstream(() => html(big));
    const res = await call(textPath('https://example.com/big'), {
      env: { MAX_TEXT_BYTES: '1000' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Truncated')).toBe('1');
    expect((await res.text()).length).toBe(1000);
  });

  it('does not flag a body of exactly the cap as truncated', async () => {
    mockUpstream(() => html('x'.repeat(1000)));
    const res = await call(textPath('https://example.com/exact'), {
      env: { MAX_TEXT_BYTES: '1000' },
    });
    expect(res.headers.get('X-Truncated')).toBe('0');
  });

  it('cancels the upstream stream once the cap is reached', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('<p>'.repeat(200)));
      },
      cancel() {
        cancelled = true;
      },
    });
    mockUpstream(() => new Response(stream, { headers: { 'Content-Type': 'text/html' } }));
    const res = await call(textPath('https://example.com/endless'), {
      env: { MAX_TEXT_BYTES: '2000' },
    });
    expect(res.headers.get('X-Truncated')).toBe('1');
    expect(cancelled).toBe(true);
  });

  it('sends an honest request: configured UA, text Accept, no Referer, cookies or Origin', async () => {
    const upstream = mockUpstream(() => html('<html></html>'));
    await call(textPath('https://example.com/headers'), {
      headers: {
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
        Cookie: 'session=secret',
        Referer: 'https://app.example/',
        Authorization: 'Bearer token',
      },
    });
    const sent = upstream.mock.calls[0];
    const req = new Request(sent?.[0] as string, sent?.[1]);
    expect(req.headers.get('User-Agent')).toContain('NewsCardMaker/1.0');
    expect(req.headers.get('Accept')).toContain('application/rss+xml');
    expect(req.headers.get('Accept-Language')).toBe('it-IT,it;q=0.9,en;q=0.8');
    for (const name of ['Referer', 'Cookie', 'Origin', 'Authorization', 'X-Forwarded-For']) {
      expect(req.headers.get(name), name).toBeNull();
    }
    expect(sent?.[1]?.redirect).toBe('manual');
  });

  it('truncates and sanitises Accept-Language', async () => {
    const upstream = mockUpstream(() => html('<html></html>'));
    await call(textPath('https://example.com/lang'), {
      headers: { 'Accept-Language': `en;q=0.9,${'x'.repeat(300)}` },
    });
    const req = new Request(upstream.mock.calls[0]?.[0] as string, upstream.mock.calls[0]?.[1]);
    expect(req.headers.get('Accept-Language')?.length).toBeLessThanOrEqual(100);
  });
});

describe('failures', () => {
  it('maps a network error to 502 UPSTREAM_UNREACHABLE', async () => {
    mockUpstream(() => {
      throw new TypeError('fetch failed');
    });
    const res = await call(textPath('https://example.com/down'));
    expect(res.status).toBe(502);
    expect(await errorCode(res)).toBe('UPSTREAM_UNREACHABLE');
  });

  it('maps a timeout to 504 UPSTREAM_TIMEOUT', async () => {
    mockUpstream(() => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    const res = await call(textPath('https://example.com/slow'));
    expect(res.status).toBe(504);
    expect(await errorCode(res)).toBe('UPSTREAM_TIMEOUT');
  });

  it('maps a stalled body to 504 as well', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('<html>'));
        controller.error(new DOMException('The operation timed out.', 'TimeoutError'));
      },
    });
    mockUpstream(() => new Response(stream, { headers: { 'Content-Type': 'text/html' } }));
    const res = await call(textPath('https://example.com/stalled'));
    expect(res.status).toBe(504);
  });

  it('turns an unexpected bug into 500 INTERNAL_ERROR without leaking details', async () => {
    mockUpstream(() => {
      throw new ProxyBug('secret detail');
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await call(textPath('https://example.com/bug'));
    // A non-abort, non-ProxyError failure from fetch is reported as unreachable, not as a crash.
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('secret detail');
    expect(log).toHaveBeenCalled();
    const logged = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toContain('example.com');
  });
});

class ProxyBug extends Error {}
