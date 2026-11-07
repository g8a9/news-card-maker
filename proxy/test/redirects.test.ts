import { afterEach, describe, expect, it, vi } from 'vitest';
import { CookieJar } from '../src/upstream.ts';
import { call, fileWith, html, imagePath, mockUpstream, PNG, textPath } from './helpers.ts';

afterEach(() => vi.restoreAllMocks());

const redirect = (location: string, status = 302, cookies: string[] = []) => {
  const headers = new Headers({ Location: location });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status, headers });
};

const errorCode = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

describe('redirects', () => {
  it('follows redirects manually and reports the final URL and hop count', async () => {
    const seen: string[] = [];
    mockUpstream((req) => {
      seen.push(req.url);
      if (req.url === 'https://example.com/a') return redirect('/b', 301);
      if (req.url === 'https://example.com/b')
        return redirect('https://www.example.com/c#frag', 308);
      return html('<html>done</html>');
    });
    const res = await call(textPath('https://example.com/a'));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Final-Url')).toBe('https://www.example.com/c');
    expect(res.headers.get('X-Redirect-Count')).toBe('2');
    expect(seen).toEqual([
      'https://example.com/a',
      'https://example.com/b',
      'https://www.example.com/c',
    ]);
  });

  it('keeps a per-request cookie jar so cookie-setting redirect chains settle (nature.com style)', async () => {
    const cookiesSeen: Array<string | null> = [];
    mockUpstream((req) => {
      cookiesSeen.push(req.headers.get('Cookie'));
      const url = new URL(req.url);
      if (url.pathname === '/articles/x' && !req.headers.get('Cookie')?.includes('idp=1')) {
        return redirect('/articles/x?check=1', 302, ['idp=1; Path=/; Secure; HttpOnly']);
      }
      if (url.searchParams.has('check') && req.headers.get('Cookie')?.includes('idp=1')) {
        return redirect('/articles/x', 302, ['seen=yes; Path=/articles']);
      }
      if (req.headers.get('Cookie')?.includes('idp=1')) return html('<title>Article</title>');
      return html('<title>Cookies are not supported</title>', {}, 400);
    });
    const res = await call(textPath('https://www.nature.test/articles/x'));
    expect(res.headers.get('X-Upstream-Status')).toBe('200');
    expect(await res.text()).toBe('<title>Article</title>');
    expect(res.headers.get('X-Redirect-Count')).toBe('2');
    expect(cookiesSeen[0]).toBeNull();
    expect(cookiesSeen[1]).toBe('idp=1');
    expect(cookiesSeen[2]).toContain('idp=1');
    expect(cookiesSeen[2]).toContain('seen=yes');
  });

  it('does not carry cookies over to a different site', async () => {
    const cookiesSeen: Array<string | null> = [];
    mockUpstream((req) => {
      cookiesSeen.push(req.headers.get('Cookie'));
      if (req.url.startsWith('https://one.example/')) {
        return redirect('https://two.example/', 302, ['tracking=1; Path=/']);
      }
      return html('<html></html>');
    });
    await call(textPath('https://one.example/start'));
    expect(cookiesSeen).toEqual([null, null]);
  });

  it('gives up after six redirects with 502 TOO_MANY_REDIRECTS', async () => {
    let n = 0;
    mockUpstream(() => redirect(`/hop-${++n}`));
    const res = await call(textPath('https://example.com/loop'));
    expect(res.status).toBe(502);
    expect(await errorCode(res)).toBe('TOO_MANY_REDIRECTS');
    expect(n).toBe(7); // the first request plus six followed redirects
  });

  it('allows exactly six redirects', async () => {
    let n = 0;
    mockUpstream(() => (n++ < 6 ? redirect(`/hop-${n}`) : html('<html>end</html>')));
    const res = await call(textPath('https://example.com/six'));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Redirect-Count')).toBe('6');
  });

  it.each([
    ['a private IPv4 address', 'http://169.254.169.254/latest/meta-data'],
    ['loopback', 'http://127.0.0.1:8080/'],
    ['localhost', 'http://localhost/admin'],
    ['an internal name', 'http://router.internal/'],
    ['the proxy itself', 'https://proxy.test/api/text?url=https%3A%2F%2Fexample.com'],
    ['a non-default port', 'https://example.com:8443/'],
  ])('re-runs the target guards on every hop: %s', async (_name, location) => {
    const upstream = mockUpstream((req) =>
      req.url === 'https://example.com/hop' ? redirect(location) : html('<html>leaked</html>'),
    );
    const res = await call(textPath('https://example.com/hop'));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('FORBIDDEN_TARGET');
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('refuses a redirect to a non-http scheme', async () => {
    mockUpstream(() => redirect('ftp://example.com/file'));
    const res = await call(textPath('https://example.com/ftp'));
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('INVALID_URL');
  });

  it('treats a redirect without Location as the final response', async () => {
    mockUpstream(
      () =>
        new Response('<html>moved</html>', {
          status: 301,
          headers: { 'Content-Type': 'text/html' },
        }),
    );
    const res = await call(textPath('https://example.com/no-location'));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Upstream-Status')).toBe('301');
  });

  it('applies the same redirect handling to images', async () => {
    mockUpstream((req) =>
      req.url.endsWith('/old.png')
        ? redirect('https://cdn.example.com/new.png')
        : new Response(fileWith(PNG), { headers: { 'Content-Type': 'image/png' } }),
    );
    const res = await call(imagePath('https://example.com/old.png'));
    expect(res.status).toBe(200);
    mockUpstream(() => redirect('http://10.0.0.5/a.png'));
    const blocked = await call(imagePath('https://example.com/evil.png'));
    expect(blocked.status).toBe(403);
  });
});

describe('CookieJar', () => {
  const url = (s: string) => new URL(s);

  it('stores host-only cookies for the exact host', () => {
    const jar = new CookieJar();
    jar.add('a=1; Path=/', url('https://www.example.com/x'));
    expect(jar.header(url('https://www.example.com/y'))).toBe('a=1');
    expect(jar.header(url('https://example.com/y'))).toBeNull();
    expect(jar.header(url('https://sub.www.example.com/y'))).toBeNull();
  });

  it('shares Domain cookies with subdomains but never with other sites', () => {
    const jar = new CookieJar();
    jar.add('a=1; Domain=.example.com; Path=/', url('https://www.example.com/'));
    expect(jar.header(url('https://news.example.com/'))).toBe('a=1');
    expect(jar.header(url('https://example.com/'))).toBe('a=1');
    expect(jar.header(url('https://notexample.com/'))).toBeNull();
  });

  it('refuses cookies for foreign domains and bare suffixes', () => {
    const jar = new CookieJar();
    jar.add('a=1; Domain=other.example; Path=/', url('https://www.example.com/'));
    jar.add('b=1; Domain=com; Path=/', url('https://www.example.com/'));
    expect(jar.size).toBe(0);
  });

  it('honours Path, Secure, Max-Age and Expires', () => {
    const jar = new CookieJar();
    const now = 1_000_000;
    jar.add('p=1; Path=/articles', url('https://example.com/'), now);
    jar.add('s=1; Secure; Path=/', url('https://example.com/'), now);
    jar.add('m=1; Max-Age=10; Path=/', url('https://example.com/'), now);
    expect(jar.header(url('https://example.com/other'), now)).toBe('s=1; m=1');
    expect(jar.header(url('https://example.com/articles/one'), now)).toContain('p=1');
    expect(jar.header(url('http://example.com/other'), now)).toBe('m=1');
    expect(jar.header(url('https://example.com/other'), now + 11_000)).toBe('s=1');
  });

  it('replaces and deletes cookies', () => {
    const jar = new CookieJar();
    jar.add('a=1; Path=/', url('https://example.com/'));
    jar.add('a=2; Path=/', url('https://example.com/'));
    expect(jar.header(url('https://example.com/'))).toBe('a=2');
    jar.add('a=gone; Path=/; Max-Age=0', url('https://example.com/'));
    expect(jar.header(url('https://example.com/'))).toBeNull();
  });

  it('puts the most specific path first and ignores nameless cookies', () => {
    const jar = new CookieJar();
    jar.add('general=1; Path=/', url('https://example.com/'));
    jar.add('specific=1; Path=/a/b', url('https://example.com/'));
    jar.add('=nameless', url('https://example.com/'));
    expect(jar.header(url('https://example.com/a/b/c'))).toBe('specific=1; general=1');
  });
});
