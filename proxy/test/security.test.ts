import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyCors, isAllowedOrigin } from '../src/cors.ts';
import { call, fakeLimiter, html, mockUpstream, ORIGIN, textPath } from './helpers.ts';

afterEach(() => vi.restoreAllMocks());

const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error;

describe('origin allowlist', () => {
  it('rejects a missing Origin with 403 and no CORS headers', async () => {
    const upstream = mockUpstream(() => html('<html></html>'));
    const res = await call(textPath('https://example.com/origin-missing'), { origin: null });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('ORIGIN_NOT_ALLOWED');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects an origin that is not on the list', async () => {
    const upstream = mockUpstream(() => html('<html></html>'));
    const res = await call(textPath('https://example.com/origin-bad'), {
      origin: 'https://evil.example',
    });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('ORIGIN_NOT_ALLOWED');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(res.headers.get('Vary')).toContain('Origin');
    expect(upstream).not.toHaveBeenCalled();
  });

  it('matches origins exactly: scheme, host and port', async () => {
    const env = { ALLOWED_ORIGINS: 'https://owner.github.io, http://localhost:5173/' };
    expect(isAllowedOrigin('https://owner.github.io', env)).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173', env)).toBe(true);
    expect(isAllowedOrigin('http://owner.github.io', env)).toBe(false);
    expect(isAllowedOrigin('https://owner.github.io.evil.example', env)).toBe(false);
    expect(isAllowedOrigin('http://localhost:3000', env)).toBe(false);
    expect(isAllowedOrigin('null', env)).toBe(false);
    expect(isAllowedOrigin(null, env)).toBe(false);
  });

  it('never treats * as a wildcard', () => {
    expect(isAllowedOrigin('https://anything.example', { ALLOWED_ORIGINS: '*' })).toBe(false);
  });

  it('does not set Allow-Origin for a disallowed origin', () => {
    const headers = new Headers();
    applyCors(headers, 'https://evil.example', { ALLOWED_ORIGINS: 'https://owner.github.io' });
    expect(headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(headers.get('Vary')).toBe('Origin');
  });
});

describe('routing and methods', () => {
  it('answers OPTIONS with 204 and CORS headers for an allowed origin', async () => {
    const res = await call('/api/text', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  it('answers OPTIONS without CORS grants for other origins', async () => {
    const res = await call('/api/text', { method: 'OPTIONS', origin: 'https://evil.example' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(res.headers.get('Access-Control-Allow-Methods')).toBeNull();
  });

  it('returns 404 NOT_FOUND for unknown paths, with CORS for allowed origins', async () => {
    const res = await call('/api/other');
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('NOT_FOUND');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it.each(['POST', 'PUT', 'DELETE', 'PATCH'])('returns 405 for %s', async (method) => {
    const res = await call(textPath('https://example.com/'), { method });
    expect(res.status).toBe(405);
    expect((await errorOf(res)).code).toBe('METHOD_NOT_ALLOWED');
  });
});

describe('error responses', () => {
  it.each([
    ['https://example.com:8443/', 403, 'FORBIDDEN_TARGET'],
    ['http://127.0.0.1/', 403, 'FORBIDDEN_TARGET'],
    ['ftp://example.com/', 400, 'INVALID_URL'],
  ])('maps %s to %i %s with CORS headers and a JSON body', async (target, status, code) => {
    const res = await call(textPath(target));
    expect(res.status).toBe(status);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ error: { code, message: expect.any(String) } });
  });

  it('rejects a missing url parameter', async () => {
    const res = await call('/api/text');
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('INVALID_URL');
  });
});

describe('rate limiting', () => {
  it('returns 429 with Retry-After when the limiter says no', async () => {
    const upstream = mockUpstream(() => html('<html></html>'));
    const res = await call(textPath('https://example.com/limited'), {
      env: { RL_TEXT: fakeLimiter(false) },
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect((await errorOf(res)).code).toBe('RATE_LIMITED');
    expect(upstream).not.toHaveBeenCalled();
  });

  it('keys the limiter by CF-Connecting-IP and uses separate limiters for text and images', async () => {
    mockUpstream(() => html('<html></html>'));
    const text = fakeLimiter();
    const image = fakeLimiter();
    await call(textPath('https://example.com/keyed'), {
      headers: { 'CF-Connecting-IP': '203.0.113.7' },
      env: { RL_TEXT: text, RL_IMAGE: image },
    });
    await call('/api/image?url=https%3A%2F%2Fexample.com%2Fa.png', {
      headers: { 'CF-Connecting-IP': '203.0.113.9' },
      env: { RL_TEXT: text, RL_IMAGE: image },
    });
    expect(text.keys).toEqual(['203.0.113.7']);
    expect(image.keys).toEqual(['203.0.113.9']);
  });

  it('falls back to a shared key when the IP header is missing', async () => {
    mockUpstream(() => html('<html></html>'));
    const text = fakeLimiter();
    await call(textPath('https://example.com/anon'), { env: { RL_TEXT: text } });
    expect(text.keys).toEqual(['unknown']);
  });

  it('checks the origin before spending a rate-limit token', async () => {
    const text = fakeLimiter();
    await call(textPath('https://example.com/x'), { origin: null, env: { RL_TEXT: text } });
    expect(text.keys).toEqual([]);
  });
});
