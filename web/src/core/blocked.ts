// Detecting blocked and low-quality pages (PLAN.md §5.7). We never try to get past a block:
// a blocked page only changes which fallback the UI offers.
import type { Extraction } from './types.ts';

/** `<title>` patterns of challenge and block pages (Appendix B.3). */
export const CHALLENGE_TITLES: RegExp[] = [
  /^just a moment/i,
  /^attention required/i,
  /security verification/i,
  /access denied/i,
  /accès restreint/i,
  /are you a (robot|human)/i,
  /pardon our interruption/i,
  /verify you are (a )?human/i,
  /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/i, // a bare hostname ("nytimes.com": DataDome)
];

export const isChallengeTitle = (title: string): boolean =>
  CHALLENGE_TITLES.some((re) => re.test(title.trim()));

/** Markers left in the body by bot-protection services. */
const BODY_MARKERS = [
  'captcha-delivery.com',
  'challenges.cloudflare.com',
  '/cdn-cgi/challenge-platform/',
  'cf-chl-',
  '_incapsula_resource',
  'px-captcha',
  'perimeterx',
  'datadome',
];

export type BlockKind =
  | 'challenge'
  | 'paywall-wall'
  | 'geo'
  | 'consent-wall'
  | 'not-html'
  | 'no-metadata';

export interface PageFacts {
  upstreamStatus: number;
  upstreamContentType: string;
  finalUrl: string;
  inputUrl: string;
  /** The document's own `<title>`. */
  title?: string;
  /** Raw page text, for body markers. May be truncated. */
  bodyText: string;
}

export interface Verdict {
  blocked: boolean;
  kind?: BlockKind;
  reason?: string;
  /** 0–1: structured title 0.4, image 0.2, date 0.15, description 0.15, site name 0.1. */
  quality: number;
  hasStructuredTitle: boolean;
}

const BLOCK_STATUSES = new Set([401, 402, 403, 407, 429, 451, 503]);

/** A headline from structured data (Open Graph or JSON-LD), as opposed to `<title>` or h1. */
export const hasStructuredTitle = (e: Extraction): boolean =>
  e.title.some((c) => (c.source === 'og' || c.source === 'jsonld') && c.score > 0);

export function qualityScore(e: Extraction): number {
  let q = 0;
  if (hasStructuredTitle(e)) q += 0.4;
  if (e.images.length > 0) q += 0.2;
  if (e.published.length > 0) q += 0.15;
  if (e.description.length > 0) q += 0.15;
  if (e.siteName.some((c) => c.source !== 'url')) q += 0.1;
  return Math.round(q * 100) / 100;
}

/**
 * A page counts as blocked when the status says so, the title is a challenge page, the body carries a
 * bot-protection marker, or it is a consent wall. Checks that could also match a healthy article
 * (a Turnstile script on a comment form, "Access denied" inside a headline) only apply when the page
 * has no structured title, which no challenge page ever has.
 */
export function assessPage(facts: PageFacts, extraction: Extraction): Verdict {
  const structured = hasStructuredTitle(extraction);
  const quality = qualityScore(extraction);
  const done = (kind: BlockKind, reason: string): Verdict => ({
    blocked: true,
    kind,
    reason,
    quality,
    hasStructuredTitle: structured,
  });

  const type = facts.upstreamContentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (type && !/html|xhtml/.test(type) && !/^text\/plain$/.test(type)) {
    return done('not-html', 'The link does not point to a web page');
  }

  try {
    const final = new URL(facts.finalUrl);
    const input = new URL(facts.inputUrl);
    if (/^consent\./i.test(final.hostname) && !/^consent\./i.test(input.hostname)) {
      return done('consent-wall', 'The site asks for cookie consent first');
    }
    if (/\/consent(\/|$)/i.test(final.pathname) && !/\/consent(\/|$)/i.test(input.pathname)) {
      return done('consent-wall', 'The site asks for cookie consent first');
    }
  } catch {
    // Unparseable URLs are the caller's problem; carry on with the other checks.
  }

  if (!structured) {
    if (BLOCK_STATUSES.has(facts.upstreamStatus)) {
      const kind: BlockKind =
        facts.upstreamStatus === 402
          ? 'paywall-wall'
          : facts.upstreamStatus === 451
            ? 'geo'
            : 'challenge';
      return done(kind, `The site answered with HTTP ${facts.upstreamStatus}`);
    }
    if (facts.title && isChallengeTitle(facts.title)) {
      const kind: BlockKind = /accès restreint/i.test(facts.title) ? 'paywall-wall' : 'challenge';
      return done(kind, `The page title is "${facts.title}"`);
    }
    const body = facts.bodyText.toLowerCase();
    if (BODY_MARKERS.some((m) => body.includes(m))) {
      return done('challenge', 'The page contains a bot-protection challenge');
    }
    if (
      extraction.title.every((c) => c.source === 'html' && c.note === 'title') ||
      extraction.title.length === 0
    ) {
      return {
        blocked: false,
        kind: 'no-metadata',
        reason: "We couldn't find a headline on this page",
        quality,
        hasStructuredTitle: false,
      };
    }
  }
  return { blocked: false, quality, hasStructuredTitle: structured };
}
