import { describe, expect, it } from 'vitest';
import { assessPage } from '../../src/core/blocked.ts';
import { buildModel, chooseCiteUrl } from '../../src/core/model.ts';
import type { Outlet } from '../../src/core/registry.ts';
import type { Extraction } from '../../src/core/types.ts';
import { extractFixture } from './helpers.ts';

const base = (canonical: Extraction['canonical']): Extraction => ({
  pageUrl: 'https://www.example.com/a/b',
  title: [],
  description: [],
  kicker: [],
  siteName: [],
  authors: [],
  published: [],
  modified: [],
  images: [],
  logos: [],
  colors: [],
  canonical,
  links: { feeds: [] },
  flags: {},
  warnings: [],
});
const c = (value: string, source: Extraction['canonical'][number]['source'], score = 0.9) => ({
  value,
  source,
  score,
});

describe('chooseCiteUrl (PLAN.md §5.5, "URLs")', () => {
  it('prefers the canonical and strips tracking parameters', () => {
    const e = base([
      c('https://www.example.com/a/b', 'link'),
      c('https://www.example.com/a/b?utm_source=x', 'url', 0.5),
    ]);
    expect(
      chooseCiteUrl(
        e,
        'https://www.example.com/a/b?utm_source=x',
        'https://www.example.com/a/b?utm_source=x',
      ).citeUrl,
    ).toBe('https://www.example.com/a/b');
  });

  it('cleans the final URL when there is no canonical', () => {
    const e = base([c('https://www.example.com/a/b?fbclid=1&id=3', 'url', 0.5)]);
    expect(chooseCiteUrl(e, 'x', 'https://www.example.com/a/b?fbclid=1&id=3#frag').citeUrl).toBe(
      'https://www.example.com/a/b?id=3',
    );
  });

  it('uses the canonical for AMP inputs', () => {
    const e = base([c('https://www.example.com/story', 'link')]);
    expect(
      chooseCiteUrl(e, 'https://www.example.com/amp/story', 'https://www.example.com/amp/story')
        .citeUrl,
    ).toBe('https://www.example.com/story');
  });

  it('ignores a canonical that points at "/" when the input was deeper', () => {
    const e = base([c('https://www.example.com/', 'link')]);
    expect(
      chooseCiteUrl(e, 'https://www.example.com/news/story', 'https://www.example.com/news/story')
        .citeUrl,
    ).toBe('https://www.example.com/news/story');
  });

  it('keeps the final URL for a cross-domain canonical and offers the canonical as an alternative', () => {
    const e = base([c('https://syndicator.test/copy-of-story', 'link')]);
    const r = chooseCiteUrl(e, 'https://www.example.com/a/b', 'https://www.example.com/a/b');
    expect(r.citeUrl).toBe('https://www.example.com/a/b');
    expect(r.options).toEqual(['https://syndicator.test/copy-of-story']);
  });

  it('follows a cross-domain canonical when the registry lists that domain', () => {
    const outlet: Outlet = { id: 'o', name: 'O', domains: ['example.com', 'example.co.uk'] };
    const e = base([c('https://www.example.co.uk/a/b', 'link')]);
    expect(
      chooseCiteUrl(e, 'https://www.example.com/a/b', 'https://www.example.com/a/b', outlet)
        .citeUrl,
    ).toBe('https://www.example.co.uk/a/b');
  });
});

describe('buildModel', () => {
  it('builds a complete model from a good page', () => {
    const { extraction, verdict, meta } = extractFixture('courier-like-overlay.html');
    const model = buildModel(extraction, {
      inputUrl: meta.inputUrl,
      finalUrl: meta.pageUrl,
      provenance: ['proxy'],
      verdict,
    });
    expect(model.status).toBe('ok');
    expect(model.citeUrl).toBe(
      'https://www.thecourier.test/transport/2026/nov/06/council-approves-harbour-tram-line',
    );
    expect(model.fields.title.value).toBe('Council approves harbour tram line after late vote');
    expect(model.fields.siteName.value).toBe('The Courier');
    expect(model.fields.authors.value).toEqual(['Jane Roe']);
    expect(model.fields.image.value).toBeNull(); // loaded later by the pipeline
    expect(model.imageCandidates.length).toBeGreaterThan(0);
    expect(model.brand.color).toBe('#052962');
    expect(model.dir).toBe('ltr');
    expect(model.blockReason).toBeUndefined();
  });

  it('marks blocked pages and keeps the reason', () => {
    const { extraction, verdict, meta } = extractFixture('cloudflare-challenge.html');
    const model = buildModel(extraction, {
      inputUrl: meta.inputUrl,
      finalUrl: meta.pageUrl,
      provenance: ['proxy'],
      verdict,
    });
    expect(model.status).toBe('blocked');
    expect(model.blockReason).toMatch(/403/);
    expect(model.fields.title.value).toBeNull();
  });

  it('marks pages without a structured title as partial', () => {
    const { extraction, verdict, meta } = extractFixture('minimal-title-only.html');
    const model = buildModel(extraction, {
      inputUrl: meta.inputUrl,
      finalUrl: meta.pageUrl,
      provenance: ['proxy'],
      verdict,
    });
    expect(model.status).toBe('partial');
    expect(model.fields.title.value).toBe('My weekend notes');
  });

  it('skips neutral colours when choosing the brand colour', () => {
    const { extraction, meta } = extractFixture('bbc-like-branded-image.html');
    const verdict = assessPage(
      {
        upstreamStatus: 200,
        upstreamContentType: 'text/html',
        finalUrl: meta.pageUrl,
        inputUrl: meta.inputUrl,
        bodyText: '',
      },
      extraction,
    );
    const model = buildModel(extraction, {
      inputUrl: meta.inputUrl,
      finalUrl: meta.pageUrl,
      provenance: ['proxy'],
      verdict,
    });
    expect(extraction.colors[0]?.value).toBe('#FFFFFF');
    expect(model.brand.color).toBe('#BB1919');
    expect(model.brand.palette).toContain('#FFFFFF');
  });

  it('defaults direction to ltr and carries RTL pages through', () => {
    const { extraction, meta } = extractFixture('arabic-rtl.html');
    expect(
      buildModel(extraction, {
        inputUrl: meta.inputUrl,
        finalUrl: meta.pageUrl,
        provenance: ['paste'],
      }).dir,
    ).toBe('rtl');
  });
});
