import { describe, expect, it } from 'vitest';
import { extract } from '../../src/core/extract/index.ts';
import type { Outlet } from '../../src/core/registry.ts';
import { NOW, parseHtml } from './helpers.ts';

const run = (
  html: string,
  pageUrl = 'https://www.example.com/news/story',
  outlet?: Outlet | null,
) => extract(parseHtml(html), { pageUrl, inputUrl: pageUrl, outlet, now: NOW });

const head = (inner: string, body = '') =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8">${inner}</head><body>${body}</body></html>`;

describe('URL resolution', () => {
  it('resolves relative URLs against <base href>, then the page URL, never the app', () => {
    const withBase = run(
      head(
        '<base href="https://cdn.example.net/assets/"><meta property="og:image" content="img/hero.jpg"><meta property="og:title" content="Title of the story">',
      ),
    );
    expect(withBase.images[0]?.value.url).toBe('https://cdn.example.net/assets/img/hero.jpg');

    const withoutBase = run(
      head(
        '<meta property="og:image" content="/img/hero.jpg"><meta property="og:title" content="Title of the story">',
      ),
    );
    expect(withoutBase.images[0]?.value.url).toBe('https://www.example.com/img/hero.jpg');
    expect(withoutBase.images[0]?.value.url).not.toContain('localhost');
  });

  it('ignores non-http(s) URLs', () => {
    const e = run(
      head(
        '<meta property="og:image" content="javascript:alert(1)"><link rel="canonical" href="data:text/html,x">',
      ),
    );
    expect(e.images).toEqual([]);
    expect(e.canonical.map((c) => c.source)).toEqual(['url']);
  });
});

describe('meta handling', () => {
  it('matches keys case-insensitively and reads meta tags in <body>', () => {
    const e = run(
      head(
        '<meta property="OG:Title" content="Upper-case keys still work">',
        '<meta property="og:site_name" content="Body Outlet">',
      ),
    );
    expect(e.title[0]?.value).toBe('Upper-case keys still work');
    expect(e.siteName[0]?.value).toBe('Body Outlet');
  });

  it('reads `name`, `property` and `itemprop` interchangeably', () => {
    const e = run(
      head(
        '<meta itemprop="description" content="A description that is long enough to count."><meta name="og:title" content="Name-keyed title here">',
      ),
    );
    expect(e.title[0]?.value).toBe('Name-keyed title here');
    expect(e.description[0]?.value).toContain('long enough');
  });

  it('attaches og:image dimensions to the image they follow and prefers secure_url', () => {
    const e = run(
      head(
        '<meta property="og:image" content="http://a.test/one.jpg"><meta property="og:image:secure_url" content="https://a.test/one.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image" content="https://a.test/two.jpg"><meta property="og:image:width" content="800"><meta property="og:image:height" content="800">',
      ),
    );
    expect(e.images.map((i) => [i.value.url, i.value.width, i.value.height])).toEqual([
      ['https://a.test/one.jpg', 1200, 630],
      ['https://a.test/two.jpg', 800, 800],
    ]);
  });

  it('drops empty meta values', () => {
    const e = run(
      head('<meta property="og:title" content="   "><meta name="description" content="">'),
    );
    expect(e.title).toEqual([]);
    expect(e.description).toEqual([]);
  });
});

describe('titles', () => {
  it('rejects an h1 that has nothing to do with the structured title', () => {
    const e = run(
      head(
        '<meta property="og:title" content="Council approves harbour tram line">',
        '<main><h1>Subscribe to our newsletter for daily updates</h1></main>',
      ),
    );
    expect(e.title.map((c) => c.source)).toEqual(['og']);
  });

  it('accepts an h1 that shares enough words, and prefers one inside main/article', () => {
    const e = run(
      head(
        '<meta property="og:title" content="Council approves harbour tram line after late vote">',
        '<header><h1>Harbour Gazette</h1></header><main><h1>Council approves the harbour tram line after a late vote</h1></main>',
      ),
    );
    expect(e.title.some((c) => c.note === 'h1')).toBe(true);
  });

  it('rejects an h1 that is only the site name or too short', () => {
    const e = run(
      head(
        '<meta property="og:site_name" content="Harbour Gazette"><meta property="og:title" content="Council approves harbour tram line">',
        '<h1>Harbour Gazette</h1>',
      ),
    );
    expect(e.title.some((c) => c.note === 'h1')).toBe(false);
    const short = run(head('', '<h1>Hello</h1>'));
    expect(short.title.some((c) => c.note === 'h1')).toBe(false);
  });

  it('gives a title equal to the site name almost no weight', () => {
    const e = run(
      head(
        '<meta property="og:site_name" content="The Courier"><meta property="og:title" content="The Courier"><title>Real article headline here | The Courier</title>',
      ),
    );
    expect(e.title[0]?.value).toBe('Real article headline here');
  });

  it('uses registry title suffixes', () => {
    const outlet: Outlet = {
      id: 'x',
      name: 'The Network',
      domains: ['example.com'],
      titleSuffixes: ['| Broadcast Network Online'],
    };
    const e = run(
      head(
        '<meta property="og:title" content="Storm closes the coast road | Broadcast Network Online">',
      ),
      undefined,
      outlet,
    );
    expect(e.title[0]?.value).toBe('Storm closes the coast road');
  });
});

describe('description, kicker, authors', () => {
  it('penalises a description that repeats the title or starts with "Read more"', () => {
    const e = run(
      head(
        '<meta property="og:title" content="Council approves harbour tram line"><meta property="og:description" content="Council approves harbour tram line"><meta name="description" content="Read more about the council decision on the harbour tram line."><meta name="twitter:description" content="Seventeen months after the first proposal, the tram finally has money.">',
      ),
    );
    expect(e.description[0]?.value).toContain('Seventeen months');
    expect(e.description.at(-1)?.score).toBeLessThan(0.2);
  });

  it('caps descriptions at 400 characters', () => {
    const long = `${'word '.repeat(200)}end`;
    const e = run(head(`<meta property="og:description" content="${long}">`));
    expect(e.description[0]?.value.length).toBeLessThanOrEqual(401);
    expect(e.description[0]?.value.endsWith('…')).toBe(true);
  });

  it('rejects junk sections and keeps real ones', () => {
    const e = run(
      head(
        '<meta property="article:section" content="news"><meta name="parsely-section" content="World">',
      ),
    );
    expect(e.kicker.map((c) => c.value)).toEqual(['World']);
  });

  it('removes institutional authors and de-duplicates', () => {
    const e = run(
      head(
        '<meta property="og:site_name" content="Daily Outlet"><meta name="author" content="Daily Outlet Staff"><meta name="author" content="Jane Roe, Jane Roe and Sam Okafor">',
      ),
    );
    expect(e.authors[0]?.value).toEqual(['Jane Roe', 'Sam Okafor']);
  });
});

describe('dates', () => {
  it('ignores dates outside the sanity window', () => {
    const e = run(
      head(
        '<meta property="article:published_time" content="1970-01-01T00:00:00Z"><meta name="date" content="2026-11-06">',
      ),
    );
    expect(e.published.map((c) => c.source)).toEqual(['meta']);
  });

  it('reads a date from the URL path as a last resort', () => {
    const e = run(
      head('<meta property="og:title" content="Story without a date tag">'),
      'https://www.example.com/2026/nov/06/story',
    );
    expect(e.published).toMatchObject([{ source: 'url', score: 0.5 }]);
  });

  it('prefers time[datetime] inside the article over one elsewhere', () => {
    const e = run(
      head(
        '',
        '<aside><time datetime="2026-11-01">Nov 1</time></aside><article><time datetime="2026-11-05">Nov 5</time></article>',
      ),
    );
    expect(e.published[0]?.value).toMatchObject({ d: 5 });
  });
});

describe('main entity and language', () => {
  it('uses the article whose URL matches the page when several are present', () => {
    const e = run(
      head(
        `<script type="application/ld+json">[{"@type":"NewsArticle","headline":"A related story from the sidebar","url":"https://www.example.com/news/other"},{"@type":"NewsArticle","headline":"The story you are reading now","url":"https://www.example.com/news/story"}]</script>`,
      ),
    );
    expect(e.title[0]?.value).toBe('The story you are reading now');
  });

  it('records a warning for unparseable JSON-LD but still extracts the rest', () => {
    const e = run(
      head(
        '<script type="application/ld+json">{ broken</script><meta property="og:title" content="Still works fine">',
      ),
    );
    expect(e.warnings).toContain('jsonld-parse-failed');
    expect(e.title[0]?.value).toBe('Still works fine');
  });

  it('prefers agreeing og:locale and inLanguage over html[lang]', () => {
    const e = run(
      '<!doctype html><html lang="en"><head><meta property="og:locale" content="fr_FR"><script type="application/ld+json">{"@type":"NewsArticle","inLanguage":"fr-FR"}</script></head></html>',
    );
    expect(e.lang).toBe('fr');
  });

  it('falls back to html[lang] when the hints disagree', () => {
    const e = run(
      '<!doctype html><html lang="de"><head><meta property="og:locale" content="fr_FR"><script type="application/ld+json">{"@type":"NewsArticle","inLanguage":"it"}</script></head></html>',
    );
    expect(e.lang).toBe('de');
  });

  it('sets direction from the language subtag', () => {
    expect(run('<!doctype html><html lang="fa-IR"><head></head></html>').dir).toBe('rtl');
    expect(run('<!doctype html><html lang="en"><head></head></html>').dir).toBe('ltr');
  });
});

describe('registry influence', () => {
  const outlet: Outlet = {
    id: 'courier',
    name: 'The Courier',
    domains: ['example.com'],
    colors: { brand: '#052962' },
    logo: {
      wordmark: { url: 'https://assets.example.net/courier-wordmark.svg' },
      icon: { url: 'https://assets.example.net/courier-icon.svg' },
    },
    imageRewrites: [{ pattern: '/branded_news/', replace: '/standard/' }],
  };
  const html = head(
    '<meta property="og:site_name" content="courier online"><meta property="og:title" content="A headline long enough"><meta property="og:image" content="https://img.example.net/branded_news/abc/photo.jpg">',
  );

  it('wins for site name, brand colour and logos', () => {
    const e = run(html, undefined, outlet);
    expect(e.siteName[0]).toMatchObject({ value: 'The Courier', source: 'registry' });
    expect(e.colors[0]).toMatchObject({ value: '#052962', source: 'registry', score: 1 });
    expect(e.logos.slice(0, 2).map((l) => [l.value.kind, l.source])).toEqual([
      ['wordmark', 'registry'],
      ['icon', 'registry'],
    ]);
  });

  it('offers rewritten image URLs next to the original', () => {
    const e = run(html, undefined, outlet);
    expect(e.images[0]?.value.url).toBe('https://img.example.net/standard/abc/photo.jpg');
    expect(e.images.map((i) => i.value.url)).toContain(
      'https://img.example.net/branded_news/abc/photo.jpg',
    );
  });
});

describe('image scoring', () => {
  it('penalises overlays, placeholders, small and extreme-aspect images', () => {
    const e = run(
      head(
        '<meta property="og:image" content="https://i.example.net/a.jpg?overlay-base64=abc"><meta name="twitter:image" content="https://i.example.net/default-image.png"><link rel="image_src" href="https://i.example.net/photo.jpg">',
      ),
    );
    const score = (u: string) => e.images.find((i) => i.value.url.includes(u))?.score ?? 0;
    expect(score('photo.jpg')).toBe(0.6);
    expect(score('overlay-base64')).toBeCloseTo(0.54, 2);
    expect(score('default-image')).toBeCloseTo(0.255, 3);

    const small = run(
      head(
        '<meta property="og:image" content="https://i.example.net/s.jpg"><meta property="og:image:width" content="200"><meta property="og:image:height" content="200">',
      ),
    );
    expect(small.images[0]?.score).toBeCloseTo(0.27, 2);
    const banner = run(
      head(
        '<meta property="og:image" content="https://i.example.net/b.jpg"><meta property="og:image:width" content="3000"><meta property="og:image:height" content="500">',
      ),
    );
    expect(banner.images[0]?.score).toBeCloseTo(0.54, 2);
  });

  it('does not treat Drupal /sites/default/ as a placeholder', () => {
    const e = run(
      head(
        '<meta property="og:image" content="https://d.example.net/sites/default/files/photo.jpg">',
      ),
    );
    expect(e.images[0]?.score).toBe(0.9);
  });
});

describe('site names', () => {
  it('prefers the better-capitalised spelling', () => {
    const e = run(
      head(
        '<meta property="og:site_name" content="the Courier"><script type="application/ld+json">{"@type":"NewsArticle","headline":"Some headline","publisher":{"name":"The Courier"}}</script>',
      ),
    );
    expect(e.siteName[0]?.value).toBe('The Courier');
  });

  it('merges "Outlet.com" into "Outlet" when another source spells it that way', () => {
    const e = run(
      head(
        '<meta property="og:site_name" content="Outlet.com"><meta name="application-name" content="Outlet">',
      ),
    );
    expect(e.siteName[0]?.value).toBe('Outlet');
  });

  it('keeps "Outlet.com" when nothing else disagrees', () => {
    const e = run(head('<meta property="og:site_name" content="Outlet.com">'));
    expect(e.siteName[0]?.value).toBe('Outlet.com');
  });

  it('falls back to the host name', () => {
    const e = run(head(''), 'https://m.example.com/x');
    expect(e.siteName[0]).toMatchObject({ value: 'example.com', source: 'url' });
  });
});
