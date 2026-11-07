# 0003: Small refinements to the extraction rules

- **Status:** accepted, 2026-11-07
- **Plan reference:** §5.3 to §5.7, §6.5

PLAN.md fixes most extraction behaviour precisely, and the implementation follows it. Working through
synthetic fixtures and a live run against 19 outlets showed a handful of places where following the text
literally gives a wrong or fragile result. Each change below is small, contained in one function, and
covered by a unit test.

## Changes

1. **Blocked-page markers only count when there is no structured title** (`core/blocked.ts`).
   §5.7 says a page is blocked if it contains markers such as `challenges.cloudflare.com`. A healthy
   article that embeds a Turnstile comment form contains that string too. Challenge, block and
   bot-protection pages never carry an `og:title` or a JSON-LD headline, so the body-marker, `<title>`
   pattern and status checks apply only when neither exists. Consent-wall and non-HTML checks are unchanged.

2. **Corporate publisher names are down-ranked wherever the corporate word sits** (`core/text.ts`).
   B.4 lists "Group", "Media Group" and "Publishing" as trailing words. Nature's JSON-LD publisher is
   "Nature Publishing Group UK", which ends with a country code, so it outranked the `application-name`
   "Nature" that §Appendix A says is the right source. The ×0.6 penalty now also applies to
   "Publishing Group" and to those words followed by UK/US/EU/Ltd/Inc.

3. **`citation_author` values are not split** (`core/extract/index.ts`). Each tag holds one person written
   "Last, First". Splitting on commas turned "Okafor, Ngozi" into two authors. The value is flipped to
   "Ngozi Okafor" instead. Other author sources are split as §5.5 describes.

4. **Agreement between meta families counts.** Dublin Core, Highwire (`citation_*`), Parse.ly and Sailthru
   keys get their own `SourceId` instead of `meta`, so `dc.date` agreeing with `citation_publication_date`
   earns the +0.05 corroboration bonus that §5.5 describes for "additional sources".

5. **Canonical candidates never keep a fragment** (`#ref=rss` on a feed-style `og:url`).

6. **Image placeholder words match whole tokens**, and `/sites/default/` is exempt (§5.5 "Image"). A plain
   substring test for "default" or "icon" would penalise every Drupal site's photos.

7. **Logos under 24 px tall are rejected, favicons included** (§6.3). A 16 px favicon scaled up to a 4u
   masthead looks worse than the generated monogram.

## Consequences

The scoring tables in §5.5 are otherwise untouched. Fixture snapshots in `web/tests/fixtures/pages`
record the resulting behaviour, and `docs/decisions` is the place to add further refinements.
