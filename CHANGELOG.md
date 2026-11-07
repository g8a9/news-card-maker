# Changelog

All notable changes to this project are listed here, newest first.

## Unreleased

- M2: pure extraction core (`extract()` over JSON-LD, Open Graph, Twitter, Parse.ly/Sailthru, Dublin Core/Highwire, microdata and HTML), ranking with alternatives, blocked-page detection, charset decoding, date/URL/text normalisation, Hacker News adapter, the `resolveArticle` pipeline with progressive events, and `npm run smoke|inspect|capture-fixture`. 261 unit tests over 24 synthetic fixtures. A live local run read all 19 cooperative outlets correctly.
- M1: Cloudflare Worker proxy with the §4 contract: `/api/text`, `/api/image`, `/health`, target guards on every redirect hop, origin allowlist, rate-limit bindings, per-request cookie jar, size and type caps, edge cache, and 180 tests running in workerd.
- M0: scaffold (npm workspaces `web` and `proxy`, Vite + TypeScript, Biome, Vitest, Playwright, Wrangler, CI skeleton, AGENTS.md).
