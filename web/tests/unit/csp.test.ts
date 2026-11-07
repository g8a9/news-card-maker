import { describe, expect, it } from 'vitest';
import { buildCsp } from '../../csp.ts';

const directives = (policy: string): Record<string, string[]> =>
  Object.fromEntries(
    policy.split(';').map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name as string, sources];
    }),
  );

describe('buildCsp', () => {
  const csp = directives(buildCsp({ proxyUrl: 'https://news-card-proxy.example.workers.dev/' }));

  it('only runs scripts from the app itself', () => {
    expect(csp['default-src']).toEqual(["'self'"]);
    expect(csp['script-src']).toEqual(["'self'"]);
    expect(buildCsp()).not.toMatch(/unsafe-eval|unsafe-inline.*script/);
  });

  it('lets styles be inline, because cards are themed with style attributes', () => {
    expect(csp['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it('allows the fetch proxy by origin, for requests and images', () => {
    expect(csp['connect-src']).toContain('https://news-card-proxy.example.workers.dev');
    expect(csp['img-src']).toContain('https://news-card-proxy.example.workers.dev');
    expect(buildCsp({ proxyUrl: 'https://p.example/api/v1' })).toContain('https://p.example;');
    expect(buildCsp({ proxyUrl: 'https://p.example/api/v1' })).not.toContain('/api/v1');
  });

  it('names the one other service the app calls from the browser', () => {
    expect(csp['connect-src']).toContain('https://hacker-news.firebaseio.com');
    const others = (csp['connect-src'] ?? []).filter((s) => s.startsWith('http'));
    expect(others.sort()).toEqual([
      'https://hacker-news.firebaseio.com',
      'https://news-card-proxy.example.workers.dev',
    ]);
  });

  it('shows pictures from blob: and data: URLs, and fonts from the app', () => {
    expect(csp['img-src']).toEqual(expect.arrayContaining(["'self'", 'blob:', 'data:']));
    expect(csp['font-src']).toEqual(["'self'", 'data:']);
  });

  it('forbids plugins, a changed base address and form posts', () => {
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'none'"]);
    expect(csp['form-action']).toEqual(["'none'"]);
  });

  it('copes with no proxy, an empty one or a bad one', () => {
    for (const proxyUrl of [undefined, '', 'not a url']) {
      const policy = buildCsp({ proxyUrl });
      expect(policy).not.toMatch(/undefined|null|not a url/);
      expect(directives(policy)['connect-src']).toEqual([
        "'self'",
        'blob:',
        'data:',
        'https://hacker-news.firebaseio.com',
      ]);
    }
  });
});
