import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collectPage } from '../../src/bookmarklet/collector.ts';
import { bookmarkletHref } from '../../src/bookmarklet/href.ts';
import { extract } from '../../src/core/extract/index.ts';
import { extractFixture, FIXTURE_DIR, NOW, parseHtml } from './helpers.ts';

const FILES = readdirSync(FIXTURE_DIR).filter(
  (f) => f.endsWith('.html') && !/challenge|datadome|paywall-402|hn-item/.test(f),
);

describe('collector', () => {
  it('keeps the pieces extraction needs and drops the rest of the page', () => {
    const doc = parseHtml(`<!doctype html><html lang="it"><head>
      <title>Titolo</title><meta property="og:title" content="Titolo OG">
      <meta name="viewport" content="width=device-width">
      <link rel="canonical" href="https://example.com/a"><link rel="stylesheet" href="/x.css">
      <link rel="icon" href="/favicon.svg"><script src="/app.js"></script>
      <script type="application/ld+json">{"@type":"NewsArticle","headline":"H"}</script>
      <style>body{color:red}</style></head>
      <body><header><a href="/"><img src="/logo.png" alt="Logo"></a></header>
      <h1>Titolo</h1><p>Secret body text of the article that must never be collected.</p>
      <time datetime="2026-11-06T10:00:00Z">6 Nov</time><footer>footer text</footer></body></html>`);
    const { v, url, html } = collectPage(doc, 'https://example.com/a?x=1');
    expect(v).toBe(1);
    expect(url).toBe('https://example.com/a?x=1');
    expect(html).toContain('<html lang="it">');
    expect(html).toContain('<base href="https://example.com/a?x=1">');
    for (const kept of [
      'og:title',
      'rel="canonical"',
      'rel="icon"',
      'NewsArticle',
      '<h1>Titolo</h1>',
      'datetime=',
    ]) {
      expect(html).toContain(kept);
    }
    expect(html).toContain('/logo.png');
    for (const dropped of ['Secret body text', 'footer text', 'app.js', 'color:red', 'x.css']) {
      expect(html).not.toContain(dropped);
    }
  });

  it('inlines the symbol an SVG logo refers to, so it still draws on its own', () => {
    const doc = parseHtml(`<!doctype html><html><head><title>t</title></head><body>
      <svg style="display:none"><symbol id="logo-mark" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></symbol></svg>
      <header><svg width="100" height="20"><use href="#logo-mark"></use></svg></header></body></html>`);
    const { html } = collectPage(doc, 'https://example.com/');
    expect(html).toContain('<symbol id="logo-mark"');
    expect(html).toContain('<use href="#logo-mark">');
  });

  it('skips oversized elements and survives quotes in the language and address', () => {
    const doc = parseHtml(
      `<!doctype html><html lang='en"x'><head><title>t</title></head><body><header><img src="/${'a'.repeat(30_000)}.png"></header></body></html>`,
    );
    const { html } = collectPage(doc, 'https://example.com/a"b');
    expect(html).not.toContain('aaaaaaaaaaaaaaaaaaaa');
    expect(html).toContain('<base href="https://example.com/a%22b">');
    expect(html).not.toMatch(/lang="[^"]*"[^>]*"x/);
  });

  it.each(FILES)('%s: extracting from the collected subset gives the same card fields', (file) => {
    const full = extractFixture(file);
    const { html, url } = collectPage(full.doc, full.meta.pageUrl);
    const sub = extract(parseHtml(html), {
      pageUrl: full.meta.pageUrl,
      inputUrl: url,
      outlet: null,
      now: NOW,
    });
    const top = <T>(list: Array<{ value: T }>) => list[0]?.value ?? null;
    const f = full.extraction;
    expect(top(sub.title)).toEqual(top(f.title));
    expect(top(sub.description)).toEqual(top(f.description));
    expect(top(sub.siteName)).toEqual(top(f.siteName));
    // Microdata wraps the article body, which is never collected, so a page that only describes
    // its author and image that way loses both through the bookmarklet (page source keeps them).
    const microdataOnly = file === 'microdata-article.html';
    if (!microdataOnly) expect(top(sub.authors)).toEqual(top(f.authors));
    expect(top(sub.published)).toEqual(top(f.published));
    if (!microdataOnly) expect(top(sub.images)).toEqual(top(f.images));
    expect(top(sub.canonical)).toEqual(top(f.canonical));
    expect(sub.dir).toEqual(f.dir);
    expect(sub.lang).toEqual(f.lang);
  });
});

describe('bookmarkletHref', () => {
  const href = bookmarkletHref('https://owner.github.io/news-card-maker/');
  const code = decodeURI(href.slice('javascript:'.length));

  it('is a javascript: URL whose value is wrapped in void()', () => {
    expect(href.startsWith('javascript:void(')).toBe(true);
    expect(code.startsWith('void(')).toBe(true);
    expect(code.endsWith(')')).toBe(true);
  });

  it('carries the app address and nothing left to fill in', () => {
    expect(code).toContain('https://owner.github.io/news-card-maker/#bm=');
    expect(code).not.toContain('__NCM_APP_URL__');
  });

  it('is valid JavaScript and fits comfortably in a bookmark', () => {
    expect(() => new Function(code)).not.toThrow();
    expect(href.length).toBeLessThan(6000);
    expect(href).not.toMatch(/\s/);
  });
});
