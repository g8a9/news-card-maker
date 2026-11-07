# Changelog

All notable changes to this project are listed here, newest first.

## Unreleased

- M4: the editor. Landing page with example chips and escape hatches; editor with top bar, stage (progressive render, fitting, scaling, click-to-focus, drag-to-focus, drop an image), action bar and a schema-driven settings panel (collapsible sections, tabs on phones); alternatives menus labelled by source; image and logo pickers with upload, drop and paste; `?url=` auto-load; keyboard shortcuts and help; loading, partial, blocked and error states; Hacker News defaults. E2E on Chromium, Firefox and WebKit.
- M3: rendering. `renderCard()` with the Classic, Split and Headline templates; Light, Dark, Brand, Paper and Mono themes with WCAG contrast guarantees; every size preset; text fitting; self-hosted variable fonts with CJK, Arabic, Hebrew and emoji fallbacks; the carbon-style frame; RTL; baked image and logo effects; and `web/dev/gallery.html` (399 cards, zero overflow in Chromium, Firefox and WebKit).
- M2: pure extraction core (`extract()` over JSON-LD, Open Graph, Twitter, Parse.ly/Sailthru, Dublin Core/Highwire, microdata and HTML), ranking with alternatives, blocked-page detection, charset decoding, date/URL/text normalisation, Hacker News adapter, the `resolveArticle` pipeline with progressive events, and `npm run smoke|inspect|capture-fixture`. 261 unit tests over 24 synthetic fixtures. A live local run read all 19 cooperative outlets correctly.
- M1: Cloudflare Worker proxy with the §4 contract: `/api/text`, `/api/image`, `/health`, target guards on every redirect hop, origin allowlist, rate-limit bindings, per-request cookie jar, size and type caps, edge cache, and 180 tests running in workerd.
- M0: scaffold (npm workspaces `web` and `proxy`, Vite + TypeScript, Biome, Vitest, Playwright, Wrangler, CI skeleton, AGENTS.md).
