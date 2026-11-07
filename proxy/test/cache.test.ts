import { afterEach, describe, expect, it, vi } from 'vitest';
import { call, fileWith, html, imagePath, mockUpstream, ORIGIN, PNG, textPath } from './helpers.ts';

afterEach(() => vi.restoreAllMocks());

describe('edge cache', () => {
  it('serves a repeated text request from the cache without touching the upstream', async () => {
    const upstream = mockUpstream(() => html('<html>cached</html>'));
    const url = textPath('https://example.com/cache-text');
    const first = await call(url);
    expect(await first.text()).toBe('<html>cached</html>');
    const second = await call(url);
    expect(await second.text()).toBe('<html>cached</html>');
    expect(second.headers.get('X-Upstream-Status')).toBe('200');
    expect(second.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('applies the current origin to cached responses', async () => {
    mockUpstream(() => html('<html>shared</html>'));
    const url = textPath('https://example.com/cache-origin');
    await call(url);
    const other = await call(url, { origin: 'https://owner.github.io' });
    expect(other.headers.get('Access-Control-Allow-Origin')).toBe('https://owner.github.io');
  });

  it('does not cache non-200 pages', async () => {
    const upstream = mockUpstream(() => html('<title>Just a moment...</title>', {}, 403));
    const url = textPath('https://example.com/cache-403');
    await call(url);
    await call(url);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('keeps separate entries per language for text', async () => {
    const upstream = mockUpstream(() => html('<html>lang</html>'));
    const url = textPath('https://example.com/cache-lang');
    await call(url, { headers: { 'Accept-Language': 'it-IT,it;q=0.9' } });
    await call(url, { headers: { 'Accept-Language': 'de-DE,de;q=0.9' } });
    await call(url, { headers: { 'Accept-Language': 'it-IT,it;q=0.8' } });
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('caches images', async () => {
    const upstream = mockUpstream(
      () =>
        new Response(fileWith(PNG, 200), {
          headers: { 'Content-Type': 'image/png', 'Content-Length': '200' },
        }),
    );
    const url = imagePath('https://cdn.example.com/cache.png');
    const first = await call(url);
    await first.arrayBuffer();
    const second = await call(url);
    expect((await second.arrayBuffer()).byteLength).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
