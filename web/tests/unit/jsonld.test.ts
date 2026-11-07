import { describe, expect, it } from 'vitest';
import {
  collectJsonLd,
  isArticleNode,
  ldAuthors,
  ldImages,
  ldPublisher,
  ldString,
  pickMainEntity,
} from '../../src/core/extract/jsonld.ts';
import { parseHtml } from './helpers.ts';

const page = (...scripts: string[]) =>
  parseHtml(
    `<html><head>${scripts.map((s) => `<script type="application/ld+json">${s}</script>`).join('')}</head></html>`,
  );

describe('collectJsonLd (PLAN.md §5.4)', () => {
  it('parses plain objects, arrays and @graph', () => {
    const data = collectJsonLd(
      page(
        '{"@type":"NewsArticle","headline":"A"}',
        '[{"@type":"Person","name":"P"},{"@type":"Organization","name":"O"}]',
        '{"@graph":[{"@type":"WebPage","name":"W"}]}',
      ),
    );
    expect(data.nodes.map((n) => n['@type'])).toEqual([
      'NewsArticle',
      'Person',
      'Organization',
      undefined,
      'WebPage',
    ]);
  });

  it('flattens nested mainEntity', () => {
    const data = collectJsonLd(
      page('{"@type":"WebPage","mainEntity":{"@type":"NewsArticle","headline":"Nested"}}'),
    );
    expect(data.nodes.some((n) => n.headline === 'Nested')).toBe(true);
  });

  it('strips comment and CDATA wrappers', () => {
    const data = collectJsonLd(
      page(
        '<!-- {"@type":"NewsArticle","headline":"Commented"} -->',
        '//<![CDATA[\n{"@type":"NewsArticle","headline":"Cdata"}\n//]]>',
      ),
    );
    expect(data.nodes.map((n) => n.headline)).toEqual(['Commented', 'Cdata']);
    expect(data.warnings).toEqual([]);
  });

  it('repairs trailing commas and raw control characters, and warns when it cannot', () => {
    const data = collectJsonLd(
      page(
        '{"@type":"NewsArticle","headline":"Trailing",}',
        '{"@type":"NewsArticle","headline":"Line\nbreak"}',
        '{"headline": nope',
      ),
    );
    expect(data.nodes.map((n) => n.headline)).toEqual(['Trailing', 'Line break']);
    expect(data.warnings).toEqual(['jsonld-parse-failed']);
  });

  it('indexes @id and resolves references one level deep', () => {
    const data = collectJsonLd(
      page(
        '{"@graph":[{"@type":"Article","headline":"H","author":{"@id":"#p"},"publisher":{"@id":"#o"}},{"@type":"Person","@id":"#p","name":"Sam Okafor"},{"@type":"Organization","@id":"#o","name":"TechWire","logo":{"@type":"ImageObject","url":"https://x.test/logo.png","width":600,"height":60}}]}',
      ),
    );
    const article = data.nodes.find((n) => n['@type'] === 'Article');
    expect(article && ldAuthors(data, article.author)).toEqual(['Sam Okafor']);
    expect(article && ldPublisher(data, article)).toMatchObject({
      name: 'TechWire',
      logo: { url: 'https://x.test/logo.png', width: 600, height: 60 },
    });
  });

  it('accepts @type arrays and schema.org URLs', () => {
    expect(isArticleNode({ '@type': ['Thing', 'NewsArticle'] })).toBe(true);
    expect(isArticleNode({ '@type': 'https://schema.org/BlogPosting' })).toBe(true);
    expect(isArticleNode({ '@type': 'WebPage' })).toBe(false);
  });
});

describe('pickMainEntity', () => {
  const json = (nodes: object[]) => collectJsonLd(page(JSON.stringify(nodes)));

  it('1: prefers the article whose url matches the page', () => {
    const data = json([
      { '@type': 'NewsArticle', headline: 'Related', url: 'https://e.com/other' },
      {
        '@type': 'NewsArticle',
        headline: 'This one',
        mainEntityOfPage: { '@id': 'https://www.e.com/this/?utm=1' },
      },
    ]);
    expect(pickMainEntity(data, ['https://e.com/this'])?.headline).toBe('This one');
  });

  it('2: otherwise the first article with a headline', () => {
    const data = json([
      { '@type': 'NewsArticle' },
      { '@type': 'Article', headline: 'Has headline' },
    ]);
    expect(pickMainEntity(data, [])?.headline).toBe('Has headline');
  });

  it('3: otherwise the first article', () => {
    const data = json([
      { '@type': 'WebPage', name: 'Page' },
      { '@type': 'Article', name: 'First' },
    ]);
    expect(pickMainEntity(data, [])?.name).toBe('First');
  });

  it('4: otherwise a WebPage with a headline or name', () => {
    const data = json([
      { '@type': 'Organization', name: 'Org' },
      { '@type': 'WebPage', name: 'Just a page' },
    ]);
    expect(pickMainEntity(data, [])?.name).toBe('Just a page');
    expect(pickMainEntity(json([{ '@type': 'Organization', name: 'Org' }]), [])).toBeNull();
  });
});

describe('field readers', () => {
  const data = collectJsonLd(page('{}'));

  it('reads strings from several shapes', () => {
    expect(ldString('  x ')).toBe('x');
    expect(ldString(['', 'second'])).toBe('second');
    expect(ldString({ '@value': 'v' })).toBe('v');
    expect(ldString(42)).toBe('42');
    expect(ldString(null)).toBeUndefined();
  });

  it('reads images from strings, objects and arrays', () => {
    expect(ldImages(data, 'https://x.test/a.jpg')).toEqual([{ url: 'https://x.test/a.jpg' }]);
    expect(
      ldImages(data, [
        { '@type': 'ImageObject', url: 'https://x.test/b.jpg', width: '1200', height: 630 },
        'https://x.test/c.jpg',
      ]),
    ).toMatchObject([
      { url: 'https://x.test/b.jpg', width: 1200, height: 630 },
      { url: 'https://x.test/c.jpg' },
    ]);
  });

  it('reads authors from persons, organisations, strings and arrays, skipping URLs', () => {
    expect(
      ldAuthors(data, [
        { '@type': 'Person', name: 'A' },
        'B',
        { '@type': 'Organization', name: 'C' },
        'https://x.test/profile/d',
      ]),
    ).toEqual(['A', 'B', 'C']);
  });
});
