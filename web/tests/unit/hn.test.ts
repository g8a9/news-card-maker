import { describe, expect, it } from 'vitest';
import { toIsoDate } from '../../src/core/dates.ts';
import {
  fetchHnItem,
  HN_BRAND,
  HN_LOGO,
  HnError,
  hnToExtraction,
  matchHn,
} from '../../src/net/adapters/hn.ts';

const story = {
  id: 4242,
  type: 'story',
  by: 'dhouston',
  time: 1_794_000_000, // 2026-11-06 21:20 UTC
  title: 'Show HN: A tiny static site generator',
  url: 'https://www.example.test/ssg?utm=1',
  score: 412,
  descendants: 113,
};

describe('matchHn', () => {
  it('matches item pages only', () => {
    expect(matchHn('https://news.ycombinator.com/item?id=4242')).toBe('4242');
    expect(matchHn('http://news.ycombinator.com/item?id=4242&p=2')).toBe('4242');
    expect(matchHn('https://news.ycombinator.com/')).toBeNull();
    expect(matchHn('https://news.ycombinator.com/user?id=pg')).toBeNull();
    expect(matchHn('https://example.com/item?id=4242')).toBeNull();
  });
});

describe('hnToExtraction', () => {
  it('maps the item to the generic Extraction shape', () => {
    const e = hnToExtraction(story, 'https://news.ycombinator.com/item?id=4242');
    expect(e.title[0]).toMatchObject({
      value: 'A tiny static site generator',
      source: 'adapter',
      score: 1,
    });
    expect(e.kicker[0]?.value).toBe('Show HN');
    expect(e.authors[0]?.value).toEqual(['dhouston']);
    expect(e.description[0]?.value).toBe('example.test');
    expect(e.siteName[0]?.value).toBe('Hacker News');
    expect(e.colors[0]?.value).toBe(HN_BRAND);
    expect(e.logos[0]?.value).toMatchObject({ url: HN_LOGO, kind: 'icon' });
    expect(e.canonical[0]?.value).toBe('https://news.ycombinator.com/item?id=4242');
    const published = e.published[0]?.value;
    expect(published && toIsoDate(published)).toBe('2026-11-06');
    expect(published?.offsetMin).toBe(0);
    expect(e.images).toEqual([]);
  });

  it.each([
    ['Ask HN: Who is hiring?', 'Ask HN', 'Who is hiring?'],
    ['Launch HN: Acme (YC S26) – Fast widgets', 'Launch HN', 'Acme (YC S26) – Fast widgets'],
    ['Tell HN: I shipped it', 'Tell HN', 'I shipped it'],
    ['show hn: lowercase prefix', 'Show HN', 'lowercase prefix'],
  ])('splits the prefix of "%s"', (title, kicker, headline) => {
    const e = hnToExtraction({ ...story, title }, 'u');
    expect(e.kicker[0]?.value).toBe(kicker);
    expect(e.title[0]?.value).toBe(headline);
  });

  it('has no kicker without a prefix and no subtitle for text posts', () => {
    const e = hnToExtraction({ ...story, title: 'Plain title', url: undefined }, 'u');
    expect(e.kicker).toEqual([]);
    expect(e.description).toEqual([]);
  });

  it('refuses comments and points at the parent', () => {
    try {
      hnToExtraction({ id: 9, type: 'comment', parent: 4242 }, 'u');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HnError);
      expect((e as HnError).code).toBe('comment');
      expect((e as HnError).parentUrl).toBe('https://news.ycombinator.com/item?id=4242');
    }
  });
});

describe('fetchHnItem', () => {
  const respond = (body: unknown, status = 200) =>
    (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

  it('fetches the Firebase API directly', async () => {
    let seen = '';
    const fetchImpl = (async (url: string) => {
      seen = url;
      return new Response(JSON.stringify(story));
    }) as unknown as typeof fetch;
    expect((await fetchHnItem('4242', fetchImpl)).title).toBe(story.title);
    expect(seen).toBe('https://hacker-news.firebaseio.com/v0/item/4242.json');
  });

  it('reports deleted, missing and unreachable items', async () => {
    await expect(fetchHnItem('1', respond(null))).rejects.toMatchObject({ code: 'not-found' });
    await expect(fetchHnItem('1', respond({ id: 1, deleted: true }))).rejects.toMatchObject({
      code: 'not-found',
    });
    await expect(fetchHnItem('1', respond({}, 500))).rejects.toMatchObject({ code: 'unavailable' });
    const down = (async () => {
      throw new TypeError('network');
    }) as unknown as typeof fetch;
    await expect(fetchHnItem('1', down)).rejects.toMatchObject({ code: 'unavailable' });
  });
});
