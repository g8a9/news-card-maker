import { describe, expect, it } from 'vitest';
import {
  assessPage,
  CHALLENGE_TITLES,
  isChallengeTitle,
  type PageFacts,
  qualityScore,
} from '../../src/core/blocked.ts';
import type { Candidate, Extraction } from '../../src/core/types.ts';
import { extractFixture } from './helpers.ts';

const cand = <T>(value: T, source: Candidate<T>['source'] = 'og'): Candidate<T>[] => [
  { value, source, score: 0.9 },
];

const empty = (): Extraction => ({
  pageUrl: 'https://e.com/a',
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
  canonical: [],
  links: { feeds: [] },
  flags: {},
  warnings: [],
});

const facts = (over: Partial<PageFacts> = {}): PageFacts => ({
  upstreamStatus: 200,
  upstreamContentType: 'text/html; charset=utf-8',
  finalUrl: 'https://e.com/a',
  inputUrl: 'https://e.com/a',
  title: 'A headline',
  bodyText: '<html></html>',
  ...over,
});

describe('challenge titles (Appendix B.3)', () => {
  it.each([
    'Just a moment...',
    'Attention Required! | Cloudflare',
    'Security Verification',
    'Access denied',
    'Accès restreint – Le Monde',
    'Are you a robot?',
    'Pardon Our Interruption',
    'Verify you are human',
    'nytimes.com',
    'www.wsj.com',
  ])('flags "%s"', (t) => {
    expect(isChallengeTitle(t)).toBe(true);
    expect(CHALLENGE_TITLES.length).toBeGreaterThan(5);
  });

  it.each(['Council approves harbour tram line', 'Space.com is hiring', '404 Media'])(
    'lets "%s" through',
    (t) => {
      expect(isChallengeTitle(t)).toBe(false);
    },
  );
});

describe('assessPage (PLAN.md §5.7)', () => {
  it.each([
    [401, 'challenge'],
    [403, 'challenge'],
    [429, 'challenge'],
    [503, 'challenge'],
    [402, 'paywall-wall'],
    [451, 'geo'],
  ])('blocks HTTP %i without a structured title', (status, kind) => {
    const v = assessPage(facts({ upstreamStatus: status }), empty());
    expect(v).toMatchObject({ blocked: true, kind });
  });

  it('does not block a 403 that still carries a structured title', () => {
    const e = { ...empty(), title: cand('Real headline') };
    expect(assessPage(facts({ upstreamStatus: 403 }), e).blocked).toBe(false);
  });

  it('blocks on a challenge <title> and on bot-protection markers', () => {
    expect(assessPage(facts({ title: 'Just a moment...' }), empty()).blocked).toBe(true);
    expect(
      assessPage(
        facts({ bodyText: '<script src="/cdn-cgi/challenge-platform/h/b"></script>' }),
        empty(),
      ).kind,
    ).toBe('challenge');
    for (const marker of [
      'captcha-delivery.com',
      'challenges.cloudflare.com',
      'cf-chl-',
      '_Incapsula_Resource',
      'px-captcha',
      'PerimeterX',
      'DataDome',
    ]) {
      expect(assessPage(facts({ bodyText: `<x>${marker}</x>` }), empty()).blocked, marker).toBe(
        true,
      );
    }
  });

  it('keeps a healthy article that embeds a bot-protection script', () => {
    const { verdict } = extractFixture('turnstile-on-healthy-article.html');
    expect(verdict.blocked).toBe(false);
  });

  it('flags consent walls by host or path', () => {
    expect(
      assessPage(facts({ finalUrl: 'https://consent.example.com/?back=x' }), empty()),
    ).toMatchObject({
      blocked: true,
      kind: 'consent-wall',
    });
    expect(assessPage(facts({ finalUrl: 'https://e.com/consent/accept' }), empty()).kind).toBe(
      'consent-wall',
    );
    expect(
      assessPage(
        facts({ finalUrl: 'https://e.com/consent/x', inputUrl: 'https://e.com/consent/x' }),
        empty(),
      ).blocked,
    ).toBe(false);
  });

  it('flags non-HTML content', () => {
    expect(assessPage(facts({ upstreamContentType: 'application/json' }), empty())).toMatchObject({
      blocked: true,
      kind: 'not-html',
    });
  });

  it('reports no-metadata (not blocked) when only <title> exists', () => {
    const e = {
      ...empty(),
      title: [{ value: 'Only title', source: 'html' as const, score: 0.5, note: 'title' }],
    };
    expect(assessPage(facts(), e)).toMatchObject({ blocked: false, kind: 'no-metadata' });
  });

  it('classifies the challenge fixtures', () => {
    expect(extractFixture('cloudflare-challenge.html').verdict).toMatchObject({
      blocked: true,
      kind: 'challenge',
    });
    expect(extractFixture('datadome.html').verdict).toMatchObject({
      blocked: true,
      kind: 'challenge',
    });
    expect(extractFixture('paywall-402.html').verdict).toMatchObject({
      blocked: true,
      kind: 'paywall-wall',
    });
    expect(extractFixture('courier-like-overlay.html').verdict.blocked).toBe(false);
  });

  it('computes the quality score', () => {
    const e: Extraction = {
      ...empty(),
      title: cand('T', 'og'),
      images: cand({ url: 'https://e.com/i.jpg' }),
      published: cand({ raw: '2026-11-06', y: 2026, m: 11, d: 6, offsetMin: null }),
      description: cand('D'),
      siteName: cand('Site', 'og'),
    };
    expect(qualityScore(e)).toBe(1);
    expect(qualityScore(empty())).toBe(0);
    expect(qualityScore({ ...empty(), siteName: cand('host', 'url') })).toBe(0);
  });
});
