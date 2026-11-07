import { describe, expect, it } from 'vitest';
import {
  cleanCitationUrl,
  comparableUrl,
  displayUrl,
  hostLabels,
  isAmpUrl,
  normalizeInput,
  registrableDomain,
  resolveUrl,
  sameSite,
} from '../../src/core/url.ts';

const url = (input: string) => {
  const r = normalizeInput(input);
  return r.ok ? r.url : r.reason;
};

describe('normalizeInput (PLAN.md §5.6.1)', () => {
  it('takes the first URL in pasted text', () => {
    expect(url('Council approves tram — https://www.example.com/news/tram?x=1 (via Twitter)')).toBe(
      'https://www.example.com/news/tram?x=1',
    );
    expect(url('see <https://example.com/a>, thanks')).toBe('https://example.com/a');
    expect(url('"https://example.com/a."')).toBe('https://example.com/a');
  });

  it('adds https:// to something that looks like a domain', () => {
    expect(url('example.com/story')).toBe('https://example.com/story');
    expect(url('www.example.co.uk')).toBe('https://www.example.co.uk/');
    expect(url('  theguardian.com/world/x  ')).toBe('https://theguardian.com/world/x');
  });

  it('unwraps redirect wrappers', () => {
    expect(url('https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1&sa=U')).toBe(
      'https://example.com/a?b=1',
    );
    expect(url('https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Fa&h=AT0')).toBe(
      'https://example.com/a',
    );
    expect(url('https://lm.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Fa')).toBe(
      'https://example.com/a',
    );
    expect(url('https://www.google.com/amp/s/example.com/story/amp')).toBe(
      'https://example.com/story/amp',
    );
    expect(url('https://example-com.cdn.ampproject.org/c/s/example.com/story.amp.html')).toBe(
      'https://example.com/story.amp.html',
    );
  });

  it('unwraps nested wrappers', () => {
    const inner = 'https://example.com/a';
    const once = `https://l.facebook.com/l.php?u=${encodeURIComponent(inner)}`;
    const twice = `https://www.google.com/url?q=${encodeURIComponent(once)}`;
    expect(url(twice)).toBe(inner);
  });

  it('warns about Google News links but keeps them', () => {
    const r = normalizeInput('https://news.google.com/articles/CBMiabc');
    expect(r.ok && r.warnings).toEqual(['google-news-redirect']);
  });

  it('rejects empty input, non-links and non-http schemes', () => {
    expect(url('')).toBe('empty');
    expect(url('   ')).toBe('empty');
    expect(url('hello world')).toBe('not-a-url');
    expect(url('ftp://example.com/file')).toBe('unsupported-scheme');
    expect(url('javascript:alert(1)')).toBe('unsupported-scheme');
    expect(url('file:///etc/passwd')).toBe('unsupported-scheme');
    expect(url('mailto:someone@example.com')).toBe('unsupported-scheme');
  });
});

describe('cleanCitationUrl (PLAN.md §5.6.4)', () => {
  it('drops tracking parameters and fragments but keeps real ones', () => {
    expect(
      cleanCitationUrl(
        'https://www.bbc.co.uk/news/c123?at_medium=RSS&at_campaign=rss&utm_source=x&id=7&fbclid=abc#ref=rss',
      ),
    ).toBe('https://www.bbc.co.uk/news/c123?id=7');
  });

  it.each([
    'utm_medium=a',
    'at_medium=a',
    'syn-abc123=1',
    'gclid=1',
    'mc_cid=1',
    'smid=nytcore-ios-share',
    'unlocked_article_code=1.abc',
    'ref=home',
    'CMP=share_btn_url',
    '_ga=2.1',
  ])('removes %s', (param) => {
    expect(cleanCitationUrl(`https://example.com/a?${param}`)).toBe('https://example.com/a');
  });

  it('keeps the query HN needs', () => {
    expect(cleanCitationUrl('https://news.ycombinator.com/item?id=4242&ref=x')).toBe(
      'https://news.ycombinator.com/item?id=4242',
    );
  });
});

describe('site helpers', () => {
  it('approximates registrable domains', () => {
    expect(registrableDomain('www.nytimes.com')).toBe('nytimes.com');
    expect(registrableDomain('news.bbc.co.uk')).toBe('bbc.co.uk');
    expect(registrableDomain('example.com')).toBe('example.com');
    expect(registrableDomain('a.b.c.example.org')).toBe('example.org');
  });

  it('compares sites', () => {
    expect(sameSite('https://www.bbc.co.uk/a', 'https://news.bbc.co.uk/b')).toBe(true);
    expect(sameSite('https://amp.example.com/a', 'https://www.example.com/a')).toBe(true);
    expect(sameSite('https://example.com/a', 'https://example.org/a')).toBe(false);
  });

  it('lists host labels for suffix matching', () => {
    expect(hostLabels('www.theguardian.com')).toContain('theguardian');
    expect(hostLabels('www.ansa.it')).toEqual(expect.arrayContaining(['ansa', 'ansa.it']));
  });

  it('spots AMP addresses', () => {
    for (const u of [
      'https://example.com/story/amp',
      'https://example.com/amp/story',
      'https://example.com/story.amp.html',
      'https://amp.example.com/story',
      'https://example.com/story?outputType=amp',
      'https://example-com.cdn.ampproject.org/c/s/example.com/story',
    ]) {
      expect(isAmpUrl(u), u).toBe(true);
    }
    expect(isAmpUrl('https://example.com/ample-supply-story')).toBe(false);
  });

  it('compares URLs ignoring scheme, www, query, fragment and trailing slash', () => {
    expect(comparableUrl('http://www.example.com/a/b/?x=1#y')).toBe(
      comparableUrl('https://example.com/a/b'),
    );
  });

  it('formats URLs for display', () => {
    const u = 'https://www.example.com/world/2026/story?id=3';
    expect(displayUrl(u, 'clean')).toBe('example.com/world/2026/story?id=3');
    expect(displayUrl(u, 'domain')).toBe('example.com');
    expect(displayUrl(u, 'full')).toBe(u);
    expect(displayUrl('https://www.example.com/', 'clean')).toBe('example.com');
  });
});

describe('resolveUrl', () => {
  it('resolves against the given base, never against the app', () => {
    expect(resolveUrl('/img/a.jpg', 'https://news.example.com/a/b')).toBe(
      'https://news.example.com/img/a.jpg',
    );
    expect(resolveUrl('//cdn.example.com/a.jpg', 'https://news.example.com/')).toBe(
      'https://cdn.example.com/a.jpg',
    );
    expect(resolveUrl('a.jpg', 'https://news.example.com/x/y.html')).toBe(
      'https://news.example.com/x/a.jpg',
    );
  });

  it('only returns http(s), plus data:image when allowed', () => {
    expect(resolveUrl('javascript:alert(1)', 'https://e.com/')).toBeNull();
    expect(resolveUrl('data:text/html,hi', 'https://e.com/', { allowDataImage: true })).toBeNull();
    expect(resolveUrl('data:image/png;base64,AAAA', 'https://e.com/')).toBeNull();
    expect(
      resolveUrl('data:image/png;base64,AAAA', 'https://e.com/', { allowDataImage: true }),
    ).toBe('data:image/png;base64,AAAA');
    expect(resolveUrl('', 'https://e.com/')).toBeNull();
    expect(resolveUrl(undefined, 'https://e.com/')).toBeNull();
  });
});
