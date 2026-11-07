import { describe, expect, it } from 'vitest';
import { guessPageUrl, looksLikeHtml, MAX_SOURCE_CHARS } from '../../src/core/source.ts';
import { parseHtml } from './helpers.ts';

describe('looksLikeHtml', () => {
  it.each([
    '<!doctype html><html><head><title>x</title></head></html>',
    '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN">',
    '  \n<html lang="it"><body>ciao</body></html>',
    '<head><meta charset="utf-8"></head>',
    '<title>Only a title</title>',
  ])('accepts %s', (text) => expect(looksLikeHtml(text)).toBe(true));

  it.each([
    '',
    'https://example.com/story',
    'Council approves tram line after late vote',
    '{"headline":"x"}',
    'a < b and c > d',
    '<div>a fragment</div>',
  ])('rejects %j', (text) => expect(looksLikeHtml(text)).toBe(false));

  it('only looks at the start of a very long text', () => {
    expect(looksLikeHtml(`${'x'.repeat(60_000)}<html>`)).toBe(false);
  });
});

describe('guessPageUrl', () => {
  const guess = (html: string) => guessPageUrl(parseHtml(html), html);

  it('reads the comment browsers add to saved pages', () => {
    expect(
      guess(
        '<!-- saved from url=(0043)https://www.example.com/news/a?x=1 -->\n<html><head></head></html>',
      ),
    ).toBe('https://www.example.com/news/a?x=1');
  });

  it('then the canonical link, og:url and base', () => {
    const head = (inner: string) => `<html><head>${inner}</head></html>`;
    expect(guess(head('<link rel="canonical" href="https://a.example/c">'))).toBe(
      'https://a.example/c',
    );
    expect(guess(head('<link rel="Canonical nofollow" href="https://a.example/c2">'))).toBe(
      'https://a.example/c2',
    );
    expect(guess(head('<meta property="og:url" content="https://a.example/o">'))).toBe(
      'https://a.example/o',
    );
    expect(guess(head('<base href="https://a.example/b/">'))).toBe('https://a.example/b/');
  });

  it('prefers the saved-from comment, then the canonical, over the others', () => {
    const both = `<!-- saved from url=(0020)https://s.example/x --><html><head>
      <link rel="canonical" href="https://c.example/x"><meta property="og:url" content="https://o.example/x"></head></html>`;
    expect(guess(both)).toBe('https://s.example/x');
    expect(guess(both.replace(/<!--.*?-->/, ''))).toBe('https://c.example/x');
  });

  it('ignores relative and non-http values, since there is nothing to resolve them against', () => {
    expect(guess('<html><head><link rel="canonical" href="/news/a"></head></html>')).toBeNull();
    expect(guess('<html><head><base href="file:///tmp/"></head></html>')).toBeNull();
    expect(
      guess('<html><head><meta property="og:url" content="javascript:1"></head></html>'),
    ).toBeNull();
    expect(guess('<html><head><title>x</title></head></html>')).toBeNull();
  });
});

describe('MAX_SOURCE_CHARS', () => {
  it('leaves room for a heavy real page', () => {
    expect(MAX_SOURCE_CHARS).toBeGreaterThanOrEqual(5_000_000);
  });
});
