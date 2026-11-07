import { describe, expect, it, vi } from 'vitest';
import {
  fetchBlob,
  fetchText,
  ProxyRequestError,
  proxyEndpoint,
  withRetry,
} from '../../src/net/proxy.ts';

const BASE = 'http://proxy.test';

const textResponse = (body: string, headers: Record<string, string> = {}) =>
  new Response(new TextEncoder().encode(body), {
    headers: {
      'X-Upstream-Status': '200',
      'X-Upstream-Content-Type': 'text/html; charset=utf-8',
      'X-Final-Url': 'https://e.com/final',
      'X-Redirect-Count': '2',
      'X-Truncated': '0',
      'X-Fetch-Ms': '123',
      ...headers,
    },
  });

const errorResponse = (status: number, code: string) =>
  new Response(JSON.stringify({ error: { code, message: `${code} happened` } }), { status });

describe('proxyEndpoint', () => {
  it('encodes the target', () => {
    expect(proxyEndpoint(`${BASE}/`, 'text', 'https://e.com/a?b=1&c=2')).toBe(
      'http://proxy.test/api/text?url=https%3A%2F%2Fe.com%2Fa%3Fb%3D1%26c%3D2',
    );
  });
});

describe('fetchText', () => {
  it('returns the bytes and the X-* metadata', async () => {
    const fetchImpl = (async () => textResponse('<html>é</html>')) as unknown as typeof fetch;
    const r = await fetchText(BASE, 'https://e.com/a', { fetchImpl });
    expect(new TextDecoder().decode(r.bytes)).toBe('<html>é</html>');
    expect(r).toMatchObject({
      upstreamStatus: 200,
      upstreamContentType: 'text/html; charset=utf-8',
      finalUrl: 'https://e.com/final',
      redirectCount: 2,
      truncated: false,
      fetchMs: 123,
    });
  });

  it('falls back to sensible defaults without headers', async () => {
    const fetchImpl = (async () => new Response('x')) as unknown as typeof fetch;
    const r = await fetchText(BASE, 'https://e.com/a', { fetchImpl });
    expect(r).toMatchObject({ upstreamStatus: 200, finalUrl: 'https://e.com/a', truncated: false });
  });

  it('forwards extra headers', async () => {
    let seen: HeadersInit | undefined;
    const fetchImpl = (async (_u: string, init?: RequestInit) => {
      seen = init?.headers;
      return textResponse('x');
    }) as unknown as typeof fetch;
    await fetchText(BASE, 'https://e.com/a', {
      fetchImpl,
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(seen).toEqual({ Origin: 'http://localhost:5173' });
  });

  it('maps proxy error bodies to ProxyRequestError', async () => {
    const mk = (res: Response) => ({ fetchImpl: (async () => res) as unknown as typeof fetch });
    await expect(fetchText(BASE, 'x', mk(errorResponse(415, 'NOT_TEXT')))).rejects.toMatchObject({
      code: 'NOT_TEXT',
      status: 415,
      message: 'NOT_TEXT happened',
    });
    await expect(
      fetchText(BASE, 'x', mk(errorResponse(403, 'FORBIDDEN_TARGET'))),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_TARGET' });
    await expect(
      fetchText(BASE, 'x', mk(errorResponse(429, 'RATE_LIMITED'))),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(
      fetchText(BASE, 'x', mk(new Response('<html>oops</html>', { status: 500 }))),
    ).rejects.toMatchObject({
      code: 'UNKNOWN',
      status: 500,
    });
  });

  it('reports a network failure as NETWORK', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(fetchText(BASE, 'x', { fetchImpl })).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('times out', async () => {
    const fetchImpl = ((_u: string, init?: RequestInit) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    await expect(fetchText(BASE, 'x', { fetchImpl, timeoutMs: 20 })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('lets the caller cancel', async () => {
    const controller = new AbortController();
    const fetchImpl = ((_u: string, init?: RequestInit) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      })) as unknown as typeof fetch;
    const pending = fetchText(BASE, 'x', { fetchImpl, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('fetchBlob', () => {
  it('returns the image blob', async () => {
    const fetchImpl = (async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'Content-Type': 'image/png' },
      })) as unknown as typeof fetch;
    const blob = await fetchBlob(BASE, 'https://e.com/a.png', { fetchImpl });
    expect(blob.size).toBe(3);
    expect(blob.type).toBe('image/png');
  });
});

describe('withRetry', () => {
  it('retries once after a transient failure', async () => {
    const task = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new ProxyRequestError('UPSTREAM_TIMEOUT', 'slow', 504))
      .mockResolvedValueOnce('ok');
    expect(await withRetry(task, 1)).toBe('ok');
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('retries on 502 even without a code', async () => {
    const task = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new ProxyRequestError('UNKNOWN', 'bad gateway', 502))
      .mockResolvedValueOnce('ok');
    expect(await withRetry(task, 1)).toBe('ok');
  });

  it('does not retry permanent failures or a second failure', async () => {
    const permanent = vi
      .fn()
      .mockRejectedValue(new ProxyRequestError('FORBIDDEN_TARGET', 'no', 403));
    await expect(withRetry(permanent, 1)).rejects.toMatchObject({ code: 'FORBIDDEN_TARGET' });
    expect(permanent).toHaveBeenCalledTimes(1);

    const flaky = vi
      .fn()
      .mockRejectedValue(new ProxyRequestError('UPSTREAM_UNREACHABLE', 'down', 502));
    await expect(withRetry(flaky, 1)).rejects.toMatchObject({ code: 'UPSTREAM_UNREACHABLE' });
    expect(flaky).toHaveBeenCalledTimes(2);
  });

  it('does not retry when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const task = vi.fn().mockRejectedValue(new ProxyRequestError('UPSTREAM_TIMEOUT', 'slow', 504));
    await expect(withRetry(task, 1, controller.signal)).rejects.toBeInstanceOf(ProxyRequestError);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
