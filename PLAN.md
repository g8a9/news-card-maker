# News Card Maker: Implementation Plan

> **Audience:** the agent that will implement this project. Read the whole document before writing code.
> **Prepared:** 2026-11-07. Facts marked *observed* come from probing 25 real news outlets on that date (Appendix A). Facts marked *verified* come from official docs or MDN compat data on that date.
> **Status of decisions:** everything here is decided unless it's listed in §17 (Owner decisions), where a default is given. If you have to deviate, record why in `docs/decisions/NNNN-title.md` and update this file.
> **Progress:** tick the milestone checkboxes in §15 as you finish them.

---

## 0. TL;DR

- **What:** a carbon.now.sh-style tool for news. Paste an article URL and get a polished card with the headline, optional subtitle, featured image, outlet logo, date and URL. Copy it to the clipboard as a PNG in one click, ready for slides.
- **Stack:** a static site (Vite + vanilla TypeScript) on **GitHub Pages**, plus a tiny **Cloudflare Worker** (~250 lines). The Worker fetches pages and images for the browser, which can't read cross-origin pages because of CORS. Both run on free tiers.
- **Where the logic lives:** all of it runs in the browser. A single pure extractor, `extract(document, pageUrl)`, handles HTML fetched through the proxy, HTML sent by the bookmarklet, and HTML the user pastes.
- **Metadata sources:** JSON-LD, Open Graph, Twitter cards, `article:*`, Parse.ly, Sailthru, Dublin Core and `citation_*` meta tags, plus HTML (`h1`, `<time>`, header logos), the web-app manifest, the outlet's RSS feed, a curated outlet registry, and site adapters (Hacker News).
- **Blocked sites:** about 1 outlet in 4 blocks server-side fetches (*observed*: The Economist, FT, NYT, WSJ, Le Monde, WaPo). **We never try to beat bot protection.** We fall back, in order, to the outlet's RSS feed, the Internet Archive, a bookmarklet that runs in the user's own browser, pasted page source, and finally manual entry.
- **Rendering:** cards are HTML/CSS templates sized in a `--u` unit, exported to PNG with `modern-screenshot`. Copy uses the async Clipboard API, with a Promise-valued `ClipboardItem` created synchronously inside the click handler (works in Chrome, Firefox and Safari; *verified*).
- **Design:** a dark, minimal UI. The landing page is one text box. The editor is a preview plus a settings panel generated from a schema.
- **Scope:** MVP is milestones M0–M7. v1.0 adds brand intelligence (registry, logo analysis, colours), feed and Wayback fallbacks, URL state and presets. Extras (QR codes, citations, batch mode and more) come after that.

---

## 1. Product

### 1.1 Problem

People who make slides cite online news by screenshotting the headline (sometimes with the banner image) and then typing the URL and date by hand. It's slow, inconsistent, often ugly, and the source details get lost.

### 1.2 Goals

| ID | Goal |
|---|---|
| G1 | Paste a URL and get a well-designed card (headline, optional subtitle, image, logo, date, URL) in under ~3 s on sites that cooperate. |
| G2 | Copy the PNG to the clipboard in one click, plus Download. Output is crisp on projectors (2× by default). |
| G3 | Stay general: work on any site that exposes standard metadata, degrade gracefully, and offer fallbacks when it doesn't. |
| G4 | Make customisation useful without turning this into a design tool: layout, size and aspect, theme and colours, a toggle per field, text overrides. |
| G5 | Static hosting plus a free-tier proxy. No accounts, no tracking, nothing stored on a server. |

**Non-goals for v1:** article body text or summaries, getting past paywalls, accounts or sync, server-side image rendering, social-post cards (X, Instagram, LinkedIn), free-form design editing (layers, dragging elements), video or GIF export.

### 1.3 Core flows

- **F1, happy path:** landing → paste URL (Enter, or paste anywhere on the page) → a skeleton card appears → the card fills in progressively (text first, then image and logo) → the user tweaks it → **Copy** → toast saying "Copied 2400×1350 PNG".
- **F2, blocked site:** the card shows whatever the fallbacks found (for example headline, subtitle and date from the outlet's RSS feed). A banner offers **Use bookmarklet**, **Paste page source** and **Add image**.
- **F3, bookmarklet:** on the article page, the user clicks the bookmarklet and the app opens with the card already made.
- **F4, manual:** "Start from scratch" → pick an outlet from the registry, or type a name → fill in the fields.
- **F5, repeat use:** the last style is remembered, named presets keep a deck consistent, and a recent-cards history is kept locally.

### 1.4 Success criteria

- On the live smoke corpus (§13.5), for outlets that don't block us, at least 90% of cards get the correct title, site name, image and date, and at least 80% get a usable logo.
- Copy works in current desktop Chrome, Safari and Firefox. This is checked by e2e tests where possible and by a manual checklist.
- Initial JS is at most 120 KB gzipped (fonts excluded). Lighthouse Performance and Accessibility on the landing page are at least 95.
- The only network endpoints are the proxy, the HN API and archive.org (fallback). They're documented in the README, and the optional ones can be switched off.

---

## 2. Key decisions

| # | Topic | Choice | Why | Rejected |
|---|---|---|---|---|
| D1 | Hosting | GitHub Pages (static) plus a Cloudflare Worker that does the fetching | A browser can't read cross-origin pages, so one server hop is unavoidable. Workers are free (100k req/day), have no cold start, and use the same language as the rest of the app (*verified*) | FastAPI on a HF Space (cold start after idle, plus harder SSRF work; kept as an option in Appendix C). Public CORS proxies (unreliable, privacy, abuse). Third-party unfurl APIs (quotas, privacy, opaque, may get past protections) |
| D2 | Where extraction runs | In the browser, as a pure TS module | One implementation for proxy, bookmarklet and paste. Easy to debug. Keeps the proxy simple and well under the free tier's 10 ms CPU budget | Server-side extraction |
| D3 | Proxy response | Raw upstream bytes as `text/plain`, plus `X-*` metadata headers. The client decodes the charset | Some sites aren't UTF-8 (*observed*: Corriere serves ISO-8859-1). The proxy origin never renders HTML, and the proxy does no parsing | Decoded HTML wrapped in JSON. Slimming with HTMLRewriter (maybe later, as an optimisation) |
| D4 | Rendering | DOM + CSS templates, exported with `modern-screenshot` behind an adapter (`@zumer/snapdom` as the alternative) | Full CSS (`text-wrap: balance`, line clamping, gradients), native i18n, RTL and emoji, and the preview is exactly what you export | Canvas 2D (all layout by hand). Satori (no WOFF2, weak RTL, fonts must be supplied per script) |
| D5 | UI framework | None: vanilla TS, a tiny store, controls generated from a schema | Small, and matches the owner's "HTML + JS" preference | React, Svelte, Preact |
| D6 | Fonts | Self-hosted `@fontsource-variable` packages plus system fallback stacks | Same-origin fonts embed reliably in exports, and nothing is requested from Google Fonts | Google Fonts CDN |
| D7 | Blocked sites | Never circumvent. Use an honest User-Agent, then fall back to machine-readable sources (RSS, archive) and the user's own browser | Ethics, terms of service, robustness | Impersonating crawler UAs, headless browsers, spoofed `Referer` |
| D8 | Logos | Layered sources: registry → page metadata and header → icons → monogram | Top outlets look perfect and the long tail looks decent | Logo APIs (Clearbit's free API shut down in Dec 2025; the alternatives need API keys) |
| D9 | Tooling | npm workspaces, Node 24+ LTS, Vite 8, TypeScript 7, Vitest 5 + jsdom, Playwright 1.65, Biome 2, Wrangler 4 (latest as of Nov 2026) | Current stable releases | — |

---

## 3. Architecture

### 3.1 Overview

```
┌──────────────────── Browser: static app (GitHub Pages) ─────────────────────┐
│ UI (landing / editor) ⇄ store ⇄ render (templates, fit) → export (PNG, clipboard)
│        │                                   ▲ ArticleModel + CardStyle        │
│        ▼                                   │                                 │
│ pipeline.resolve(url) → sources → core/extract (pure) → rank → brand/enrich  │
│    │ adapters (HN API, direct)   │ feeds / wayback    │ images & manifests   │
└────┼─────────────────────────────┼────────────────────┼──────────────────────┘
     │ GET /api/text?url=          │                    │ GET /api/image?url=
     ▼                             ▼                    ▼
┌────────────────── Cloudflare Worker (proxy/) ───────────────────┐
│ guards (origin, target, rate) → upstream fetch (manual redirects,│
│ per-request cookie jar, timeouts, byte caps) → bytes + X-* + CORS│
└─────────────────────────────┬────────────────────────────────────┘
                              ▼
          news site · CDN · RSS feed · web.archive.org
```

The browser calls these directly, because they send CORS headers (*verified*): `hacker-news.firebaseio.com` (HN item API) and `archive.org/wayback/available` (snapshot lookup).

### 3.2 What happens on `resolve(url)`

1. Normalise the input (§5.6.1).
2. Look up the outlet in the registry by host (§6.1).
3. If an adapter matches (HN), use it. Otherwise call `/api/text`.
4. Decode the bytes (§5.2), parse with `DOMParser('text/html')`, and run `extract()` to get raw candidates (§5.3–5.5).
5. Check whether the page is blocked or poor quality (§5.7). If so, run the fallbacks (§5.8) and merge their candidates.
6. Rank and select. Emit **content-ready**: the card renders its text immediately.
7. Enrich asynchronously: fetch the manifest, validate images, analyse logos, compute brand colours, extract the image palette. Each step emits an update and the card refines in place.
8. Emit **done**. Cache the `ArticleModel` in memory for the session.

### 3.3 Repository layout

```
news-card-maker/
├─ PLAN.md · README.md · AGENTS.md · CLAUDE.md (contains "@AGENTS.md") · LICENSE (MIT)
├─ package.json (npm workspaces: web, proxy) · biome.json · tsconfig.base.json · .nvmrc · .editorconfig
├─ docs/decisions/            # short ADRs (0001-capture-library.md, …)
├─ web/                       # static app (Vite + TS)
│  ├─ index.html · vite.config.ts · public/ (favicon.svg, og.png, manifest.webmanifest)
│  ├─ dev/gallery.html        # dev-only page: every template × theme × size, rendered from fixtures
│  └─ src/
│     ├─ main.ts · config.ts  # config: PROXY_URL etc. from import.meta.env
│     ├─ core/                # PURE: no network, no globals except a Document passed in
│     │  ├─ types.ts · url.ts · text.ts · dates.ts · charset.ts · blocked.ts · feeds.ts · registry.ts
│     │  └─ extract/ index.ts · meta.ts · jsonld.ts · links.ts · dom.ts · rank.ts
│     ├─ net/                 # proxy.ts · pipeline.ts · images.ts · manifest.ts · wayback.ts · feedmatch.ts · adapters/hn.ts
│     ├─ brand/               # outlets.json · logo.ts (analyse/recolour) · palette.ts · theme.ts (OKLCH + contrast)
│     ├─ render/              # card.ts · h.ts (DOM helper) · fit.ts · fonts.ts · card.css · templates/*.ts
│     ├─ export/              # capture.ts (library adapter) · clipboard.ts · download.ts · filename.ts
│     ├─ state/               # store.ts · defaults.ts · url-state.ts · persist.ts
│     ├─ ui/                  # app.ts · landing.ts · editor.ts · panel.ts · controls/schema.ts · controls/*.ts · toasts.ts · shortcuts.ts · dialogs/*.ts · styles/{tokens.css, app.css}
│     └─ bookmarklet/         # collector.ts (runs on news pages) · receive.ts (reads #bm=)
│  └─ tests/                  # unit/*.test.ts · fixtures/pages/*.html + *.expected.json · e2e/*.spec.ts
├─ proxy/                     # Cloudflare Worker
│  ├─ wrangler.jsonc · src/{index.ts, guards.ts, upstream.ts, sniff.ts, cors.ts, errors.ts} · test/*.test.ts
├─ scripts/                   # build-bookmarklet.ts · smoke.ts · capture-fixture.ts · registry-check.ts · check-no-innerhtml.ts
└─ .github/workflows/         # ci.yml · deploy.yml · smoke.yml
```

### 3.4 Dependencies (keep the list short)

| Purpose | Package |
|---|---|
| Build / dev | `vite`, `typescript`, `esbuild` (explicit dev dependency, for the bookmarklet; don't rely on Vite internals) |
| DOM capture | `modern-screenshot` (alternative: `@zumer/snapdom`; pick one after the spike in M5) |
| Colour math | `culori` (tree-shakeable `culori/fn`: OKLCH conversions, `wcagContrast`) |
| Fonts | `@fontsource-variable/newsreader`, `/source-serif-4`, `/inter`, `/inter-tight`, `/jetbrains-mono` |
| QR (extras) | `uqr` |
| ZIP (extras) | `fflate` |
| Tests | `vitest`, `jsdom`, `@playwright/test`, `@cloudflare/vitest-pool-workers` |
| Lint / format | `@biomejs/biome` |
| Proxy | `wrangler`, `@cloudflare/workers-types` |

TypeScript 7 is the native compiler and is only used for `tsc --noEmit` type-checking (Vite strips types itself). If a tool doesn't support TS 7 yet, pin TS 5.9 or 6.x for that tool only.

---

## 4. Fetch proxy (Cloudflare Worker)

### 4.1 Endpoints

**`GET /api/text?url=<encoded absolute URL>`** fetches HTML, XML (RSS, Atom) and JSON (manifest, oEmbed).

- Upstream `Accept`: `text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml;q=0.9,application/atom+xml;q=0.9,application/json;q=0.8,*/*;q=0.5`.
- Allowed upstream content types: `text/html`, `application/xhtml+xml`, `text/xml`, `application/xml`, `application/rss+xml`, `application/atom+xml`, `application/rdf+xml`, `application/json`, `application/ld+json`, `application/manifest+json`, `application/json+oembed`, `text/plain`. If the header is missing, sniff the first non-whitespace byte (`<` or `{`). Anything else returns `415 NOT_TEXT`.
- The body is buffered up to `MAX_TEXT_BYTES` (default 3,000,000), then the upstream stream is cancelled. Pages are big (*observed*: Wired's HTML is 1.9 MB; Il Sole 24 ORE's `<head>` alone is 850 KB). Buffering keeps the headers accurate and costs almost no CPU.
- Respond **200 even when the upstream status is 4xx/5xx**, as long as the response body has an allowed type. The client needs that body to recognise challenge pages.
- Response headers:
  - `Content-Type: text/plain` (raw bytes; the client must use `arrayBuffer()`, never `text()`)
  - `X-Upstream-Status`, `X-Upstream-Content-Type`, `X-Final-Url`, `X-Redirect-Count`, `X-Truncated: 0|1`, `X-Fetch-Ms`
  - `Access-Control-Allow-Origin: <allowed origin>`, `Vary: Origin`, and `Access-Control-Expose-Headers` listing every `X-*` header above
  - `Cache-Control: public, max-age=600` if the upstream returned 200, otherwise `no-store`
  - `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`

**`GET /api/image?url=<encoded absolute URL>`** fetches images.

- Upstream `Accept`: `image/avif,image/webp,image/svg+xml,image/png,image/jpeg,image/gif,image/x-icon,image/*;q=0.8`.
- Allowed types, checked against the header **and** the magic bytes in the first chunk:

  | Type | Signature |
  |---|---|
  | JPEG | `FF D8 FF` |
  | PNG | `89 50 4E 47` |
  | GIF | `47 49 46 38` |
  | WebP | `RIFF....WEBP` |
  | AVIF | `ftypavif` or `ftypavis` at byte offset 4 |
  | ICO | `00 00 01 00` |
  | BMP | `42 4D` |
  | SVG | optional BOM, whitespace, XML declaration or comments, then `<svg` within the first 1 KB |

  A mismatch returns `415 NOT_IMAGE`.
- Size cap is `MAX_IMAGE_BYTES` (default 15 MB). Reject early if `Content-Length` is over the cap, and error the stream if the bytes exceed it (images are never truncated). Over the cap returns `413 IMAGE_TOO_LARGE`.
- Response: the upstream bytes, with `Content-Type` set to the sniffed type, `Cache-Control: public, max-age=86400`, CORS headers, `Cross-Origin-Resource-Policy: cross-origin` and `X-Content-Type-Options: nosniff`. **For SVG**, also send `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`, so the file is inert even if someone opens it directly.
- If the upstream returns non-2xx, respond `502 UPSTREAM_HTTP_ERROR` with `X-Upstream-Status`.

**`GET /health`** returns `{"ok":true,"version":"<git sha>"}`. `OPTIONS` returns 204 with CORS headers (rarely used, since the client only sends simple GETs with no custom headers, which means no preflight).

### 4.2 Upstream request policy

- **User-Agent:** `Mozilla/5.0 (compatible; NewsCardMaker/1.0; +https://github.com/<owner>/news-card-maker)`, configurable via `USER_AGENT`. It's honest and points to a page that explains the tool. *Observed:* this UA got exactly the same responses as a desktop Chrome UA on all 25 outlets tested.
- **Accept-Language:** forward the client's header (truncated to 100 chars), so localised outlets serve the user's language.
- **Never** send a `Referer`, client cookies or credentials. **Never** impersonate another crawler (Googlebot, facebookexternalhit, Slackbot, …) or a browser fingerprint.
- **Redirects:** `redirect: 'manual'`, at most 6 hops. Re-run the target guards (§4.3) on every hop. Keep a **per-request cookie jar**: use `getSetCookie()`, then send `Cookie` on later hops to the same host (or to hosts covered by the cookie's `Domain` attribute). *Observed:* nature.com redirects 3 times to set cookies, and without a jar the final URL ends up with `?error=cookies_not_supported`. The cookie jar never outlives the request.
- **Timeouts:** 8 s for text and 10 s for images, via `AbortSignal.timeout`. Waiting for the network doesn't count against the 10 ms free CPU budget (*verified*).
- **CPU discipline:** never parse bodies. Only sniff at most the first 1 KB. Decompression is done by the runtime.

### 4.3 Security

- **Origin allowlist** via `ALLOWED_ORIGINS` (comma-separated, for example `https://<owner>.github.io,http://localhost:5173`). `/api/*` requires an allowed `Origin` header. Browsers always send one on cross-origin `fetch`, and `<img crossorigin>` sends one too. A missing or disallowed origin returns `403 ORIGIN_NOT_ALLOWED`. Non-browser clients can fake the header, but the remaining limits keep that harmless.
- **Target guards** (each failure returns `400 INVALID_URL` or `403 FORBIDDEN_TARGET`):
  - Scheme must be `http` or `https`, on the default port (or an explicit 80/443). No `user:pass@`.
  - The hostname must contain a dot and must not be `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.home.arpa` or the Worker's own hostname.
  - Reject IP literals in these ranges:
    - IPv4: `0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`, `192.168/16`, `198.18/15`, `224/4`, `240/4`
    - IPv6: `::1`, `fc00::/7`, `fe80::/10`, IPv4-mapped private addresses

  Workers can't reach private networks anyway, but the guards keep the contract identical to the FastAPI port, where they're essential.
- **Rate limiting** uses the Workers Rate Limiting binding (*verified*: config key `ratelimits`, period must be 10 or 60 s, approximate per location), keyed by `CF-Connecting-IP`: text 30/min, image 240/min. Over the limit returns `429 RATE_LIMITED` with `Retry-After: 60`.
- Don't forward any upstream headers other than the sanitised content type. Never set cookies. Keep logs free of URLs (only error codes and counts).

### 4.4 Caching

- **Edge:** `caches.default`, keyed by endpoint plus the normalised target URL. Text is cached 10 min (only if the upstream returned 200), images 24 h. The Cache API is guaranteed to work on **custom domains**; treat it as best effort on `workers.dev` (*verified*: the docs only promise "functional cache operations" for custom domains).
- **Browser:** honours the `Cache-Control` headers above. The app also keeps an in-memory `Map<url, ArticleModel>` for the session.

### 4.5 Skeleton (illustrative)

```ts
export interface Env {
  ALLOWED_ORIGINS: string; USER_AGENT: string; MAX_TEXT_BYTES: string; MAX_IMAGE_BYTES: string;
  RL_TEXT: RateLimit; RL_IMAGE: RateLimit;
}
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const u = new URL(req.url);
    const origin = req.headers.get('Origin');
    if (req.method === 'OPTIONS') return preflight(origin, env);
    if (u.pathname === '/health') return json({ ok: true, version: VERSION });
    const kind = u.pathname === '/api/text' ? 'text' : u.pathname === '/api/image' ? 'image' : null;
    if (!kind) return fail(404, 'NOT_FOUND', origin, env);
    if (req.method !== 'GET') return fail(405, 'METHOD_NOT_ALLOWED', origin, env);
    if (!isAllowedOrigin(origin, env)) return fail(403, 'ORIGIN_NOT_ALLOWED', null, env);
    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
    const { success } = await (kind === 'text' ? env.RL_TEXT : env.RL_IMAGE).limit({ key: ip });
    if (!success) return fail(429, 'RATE_LIMITED', origin, env, { 'Retry-After': '60' });
    try {
      const target = parseTarget(u.searchParams.get('url'), u.hostname);   // guards, throws ProxyError
      const cached = await cacheLookup(kind, target);
      if (cached) return withCors(cached, origin, env);
      const up = await fetchUpstream(target, kind, req.headers.get('Accept-Language'), env); // redirects + jar + timeout
      const res = kind === 'text' ? await textResponse(up, env) : await imageResponse(up, env); // caps + sniff
      ctx.waitUntil(cacheStore(kind, target, res.clone()));
      return withCors(res, origin, env);
    } catch (e) { return failFrom(e, origin, env); }
  },
};
```

### 4.6 Error codes (JSON body `{ "error": { "code", "message" } }`)

| HTTP | code | Meaning |
|---|---|---|
| 400 | `INVALID_URL` | Missing, malformed or non-http(s) target |
| 403 | `FORBIDDEN_TARGET` | Private, loopback or reserved target, or the proxy itself |
| 403 | `ORIGIN_NOT_ALLOWED` | Origin isn't allowlisted |
| 404 / 405 | `NOT_FOUND` / `METHOD_NOT_ALLOWED` | — |
| 413 | `IMAGE_TOO_LARGE` | Image over the cap |
| 415 | `NOT_TEXT` / `NOT_IMAGE` | Content type or magic bytes not allowed |
| 429 | `RATE_LIMITED` | Too many requests |
| 502 | `UPSTREAM_UNREACHABLE` / `UPSTREAM_HTTP_ERROR` / `TOO_MANY_REDIRECTS` | DNS/TLS/connection failure, non-2xx image response, redirect loop |
| 504 | `UPSTREAM_TIMEOUT` | Timed out |

### 4.7 Config and local development

- `proxy/wrangler.jsonc`:
  - `name: "news-card-proxy"`, `main: "src/index.ts"`, `compatibility_date` set to the implementation day
  - `vars`: `ALLOWED_ORIGINS`, `USER_AGENT`, `MAX_TEXT_BYTES`, `MAX_IMAGE_BYTES`
  - `ratelimits`: `RL_TEXT` (`namespace_id` "1001", limit 30, period 60) and `RL_IMAGE` ("1002", 240, 60)
  - `observability` minimal
- Locally, `npm run dev -w proxy` runs `wrangler dev` on `:8787`, and `npm run dev -w web` uses `VITE_PROXY_URL=http://localhost:8787`. Root `npm run dev` runs both.
- Use only web-standard APIs (`fetch`, `Request`, `Response`, `URL`, streams), so the proxy can move to Deno Deploy, Vercel Edge or Node with little glue.
- Capacity: one card costs about 1 text request, 0–3 feed/manifest/archive requests and 3–6 image requests. That's roughly 10k cards/day on the free tier.

---

## 5. Extraction engine

### 5.1 Principles

- `core/extract` is **pure and deterministic**: `extract(doc: Document, ctx: { pageUrl: string; inputUrl: string }) → Extraction`. No network calls, no `window` and no `document.baseURI`. A `DOMParser` document's base URI is the app's URL, so **always resolve URLs with `new URL(href, base)`**, where `base` is the page's `<base href>` resolved against `pageUrl`, or else `pageUrl`.
- Read from the **whole document**, not just `<head>`, because some templates put `meta` tags in `<body>`.
- Keep **every candidate**, each with a source and a score. The UI offers the alternatives whenever they differ.
- The parsed document is inert (`DOMParser` doesn't run scripts or load subresources). Never insert parsed nodes into the live DOM.

### 5.2 Decoding bytes

Charset precedence:

1. BOM.
2. `charset=` in `X-Upstream-Content-Type`.
3. For HTML, `<meta charset>` or `<meta http-equiv="Content-Type" content="…charset=…">` in the first 4096 bytes (scan them as ASCII). For XML, `encoding="…"` in the XML declaration.
4. `utf-8`.

Decode with `new TextDecoder(label)`, falling back to UTF-8 if the label is unknown. Never use `Response.text()`, which always decodes as UTF-8. *Observed:* Corriere della Sera article pages are ISO-8859-1.

### 5.3 What to collect

Match meta keys case-insensitively against `property`, `name` and `itemprop`. Read `content` (or `value`), trim it, and take the first non-empty value for scalar fields. Collect every value for list fields (authors, images, tags).

| Source | Keys / selectors |
|---|---|
| Open Graph | `og:title`, `og:description`, `og:image` (+`:secure_url`, `:width`, `:height`, `:alt`), `og:site_name`, `og:url`, `og:type`, `og:locale`, `og:updated_time` |
| OG article | `article:published_time`, `article:modified_time`, `article:section`, `article:tag`, `article:author` (ignore if it's a URL), `article:publisher` (ignore URLs) |
| Twitter | `twitter:title`, `twitter:description`, `twitter:image`, `twitter:image:src`, `twitter:image:alt`, `twitter:site` |
| JSON-LD | every `script[type="application/ld+json"]`, in head **and** body (§5.4) |
| Microdata | `[itemprop=headline]`, `[itemprop=datePublished]` (`content` or `datetime`), `[itemprop=author] [itemprop=name]` |
| Parse.ly / Sailthru | `parsely-title`, `parsely-pub-date`, `parsely-author`, `parsely-section`, `parsely-image-url`, `sailthru.title`, `sailthru.date`, `sailthru.author`, `sailthru.image.full` |
| Dublin Core / Highwire | `dc.title`, `dc.date`, `dc.date.issued`, `dcterms.created`, `dc.creator`, `dc.publisher`, `citation_title`, `citation_author` (multi), `citation_publication_date`, `citation_date`, `citation_journal_title` |
| Generic meta | `description`, `author`, date keys (Appendix B.2), `application-name`, `apple-mobile-web-app-title`, `theme-color` (with `media`), `msapplication-TileColor` |
| Links | `canonical`, `amphtml`, `manifest`, `icon` / `shortcut icon` (`sizes`, `type`), `apple-touch-icon(-precomposed)`, `mask-icon` (`color`), `image_src`, `alternate` (RSS/Atom → feeds; `json+oembed` → oEmbed), `base[href]` |
| HTML | `html[lang]`, `html[dir]`, `<title>`, the first `h1` (prefer one inside `article`, `main` or `[role=main]`), `time[datetime]` (prefer inside the article header), header logos (§6.2) |

### 5.4 JSON-LD

- **Parse:** strip `<!-- -->` and CDATA wrappers, then `JSON.parse`. If that fails, remove trailing commas and raw control characters and try once more. If it still fails, skip the block and record a warning.
- **Flatten** top-level arrays, `@graph` and nested `mainEntity`. Build an `@id` index and resolve `{"@id": …}` references one level deep when reading fields (*observed*: TechCrunch/Yoast authors are `@id` references).
- **`@type`** may be a string or an array. The article family is `NewsArticle`, `Article`, `ReportageNewsArticle`, `AnalysisNewsArticle`, `OpinionNewsArticle`, `BackgroundNewsArticle`, `ReviewNewsArticle`, `BlogPosting`, `LiveBlogPosting`, `TechArticle`, `ScholarlyArticle`, `Report`, `SocialMediaPosting`, and `VideoObject` (treated as article-like).
- **Main entity:** the first rule that matches wins.
  1. An article-family node whose `url` or `mainEntityOfPage` (`@id`) matches the canonical or final URL, ignoring query, fragment and trailing slash.
  2. The first article-family node with a `headline`.
  3. The first article-family node.
  4. A `WebPage` with a `headline` or `name`.
- **Strings:** decode HTML entities by parsing `'<!doctype html><textarea>' + s` with an inert `DOMParser` (pre-escape `</` as `&lt;/` first) and reading the textarea's `.value`. Textarea content is RCDATA, so entities are decoded and no markup is created. This avoids `innerHTML` (§7.1 guard). Run a second pass if entity patterns are still left (double encoding). *Observed:* Corriere's `headline` contains `&#44;` and `&#233;`.
- **Fields:** `headline`, `alternativeHeadline`, `name`, `description`, `datePublished`, `dateCreated`, `dateModified`, `author`, `publisher{name, logo}`, `image`, `thumbnailUrl`, `articleSection`, `keywords`, `inLanguage`, `isAccessibleForFree`, `url`, `mainEntityOfPage`. `author` may be a Person, an Organization, a string or an array. `image` may be a string, an `ImageObject` or an array.

### 5.5 Resolving each field

Candidate score = `base(source) × quality(value)`, plus 0.05 for each additional source that agrees after normalisation, capped at 1. The highest score wins. Keep up to 5 distinct alternatives for the picker.

**Title**

- Base scores:

  | Source | Base |
  |---|---|
  | adapter | 1.00 |
  | `ld.headline` | 0.90 |
  | `og:title` | 0.88 |
  | validated `h1` | 0.86 |
  | `twitter:title` | 0.82 |
  | `parsely`, `sailthru`, `citation`, `dc` titles | 0.75 |
  | feed item | 0.70 |
  | `<title>` | 0.50 |

- An `h1` counts as validated if it's 15–300 characters, isn't the site name, and shares at least 40% of its tokens with `og:title` or `ld.headline` (when either exists).
- Quality multipliers: under 10 or over 300 characters ×0.5; equal to the site name ×0.1; matches a challenge pattern (§5.7) ×0.
- Every title candidate goes through cleanup (§5.6.2) and suffix stripping (§5.6.3).
- *Observed:* titles disagree often. On Spiegel, `og:title`, `ld.headline` and `h1` were three different strings. Wired has a social `og:title` that differs from its SEO headline. So the **Headline alternatives** menu is essential.

**Subtitle (deck)**

- `og:description` 0.85, `ld.description` 0.85, `ld.alternativeHeadline` 0.80, `twitter:description` 0.80, meta `description` 0.75, feed `description` 0.70.
- Penalise candidates that equal the title or start with "Read more"/"Click here". Strip HTML from feed descriptions. Keep at most 400 characters (rendering clamps them).

**Kicker (section)**

- `ld.articleSection` 0.8, `article:section` 0.75, `parsely-section` 0.7, feed `category` 0.5.
- Reject junk values (Appendix B.5; *observed*: Wired's `article:section` is literally "tags"). Hidden by default.

**Site name**

- Base scores:

  | Source | Base |
  |---|---|
  | registry | 1.0 |
  | `og:site_name` | 0.85 |
  | `ld.publisher.name` | 0.80 |
  | `application-name` | 0.60 |
  | manifest `name` / `short_name` | 0.55 |
  | `apple-mobile-web-app-title` | 0.55 |
  | trailing `<title>` segment | 0.45 |
  | hostname without `www.`, `m.`, `amp.` | 0.20 |

- Normalisation:
  - If candidates are equal ignoring case, prefer the better-capitalised one (*observed*: `og:site_name` "the Guardian" vs `ld` "The Guardian").
  - Strip a trailing TLD when another candidate equals the stripped form ("Bloomberg.com" → "Bloomberg").
  - Multiply legal-entity names by ×0.6 (Appendix B.4; *observed*: El País `ld.publisher` is "Ediciones EL PAÍS S.L.").

**Authors**

- `ld.author` (person names, with `@id` resolved) 0.9, `citation_author` 0.85, meta `author` 0.75, `parsely-author`/`sailthru.author` 0.75, feed `dc:creator` 0.7, `article:author` 0.6 (only if it isn't a URL).
- Split on `,`, `;` and localised "and" (`and`, `e`, `y`, `und`, `et`). Strip leading "By", "Di", "Par", "Von", "Por", "De".
- Treat **institutional values** as no author: anything equal to the site name, or matching `/\b(staff|redazione|agenzia|newsroom|editorial|desk)\b/i` (*observed*: "Al Jazeera Staff", "Agenzia ANSA", "DER SPIEGEL").
- Format with `Intl.ListFormat`. Offer "A, B et al." when there are more than 3 authors. Hidden by default.

**Dates**

- Published:

  | Source | Base |
  |---|---|
  | adapter | 1.0 |
  | `ld.datePublished` | 0.90 |
  | `article:published_time` | 0.88 |
  | other meta keys (Appendix B.2) | 0.75 |
  | feed `pubDate` | 0.70 |
  | `time[datetime]` in the article header | 0.65 |
  | URL path date (`/2026/11/07/`, `/2026-11-07/`, `/2026/nov/06/`) | 0.50 |

- Modified: `ld.dateModified`, `article:modified_time`, `og:updated_time`.
- Parse all of these formats:
  - ISO 8601 with offsets `Z`, `±hh:mm`, `±hhmm` (*observed*: ANSA and Il Sole 24 ORE use `+0100`, which is unsafe for `Date.parse` in Safari), and `±hh`
  - Fractional seconds
  - `YYYY-MM-DD HH:MM:SS` without a time zone (*observed*: Sailthru, Spiegel `<time>`), treated as publisher-local
  - Date-only `YYYY-MM-DD`
  - RFC 2822 (feeds)
  - Epoch seconds or milliseconds
- Sanity window: 1995 to now + 1 day.
- Store a `PartialDate` and **display the calendar date as written in the source's own offset**. Never convert to the viewer's time zone: an article published 23:46 at −05:00 is dated the 6th, even for a viewer in Rome.
- If sources differ only by offset, count them as agreeing (*observed*: Il Post's `ld` says +02:00 while its meta says +01:00, same day).
- Format with `Intl.DateTimeFormat(locale, { dateStyle })`.
- Options: "Updated {date}" (when modified is more than 1 day after published) and "Accessed {today}".

**Image**

- Base scores:

  | Source | Base |
  |---|---|
  | `og:image` (prefer `secure_url`) | 0.90 |
  | `twitter:image` | 0.85 |
  | each `ld.image` | 0.85 |
  | `parsely-image-url` / `sailthru.image.full` | 0.70 |
  | feed `media:content` / `media:thumbnail` / `enclosure` | 0.70 |
  | `ld.thumbnailUrl` | 0.60 |
  | `link[rel=image_src]` | 0.60 |
  | first large `img` in `article` (largest of `srcset`, `data-src`, `src`) | 0.40 |

- Multipliers:
  - URL has overlay or branding markers (`overlay-`, `/branded`, `watermark`): ×0.6. *Observed:* The Guardian's `og:image` and `twitter:image` carry a burned-in logo (`overlay-base64=…`, signed URL) while JSON-LD lists clean 1200×1200, 1200×900 and `fit=max` variants. BBC's `og:image` path is `/ace/branded_news/`.
  - URL has `logo`, `placeholder`, `default`, `fallback`, `blank`, `sprite`, `avatar` or `icon`: ×0.3.
  - Declared width under 400: ×0.3.
  - Aspect outside 0.5–2.5: ×0.6.
- Registry `imageRewrites` can fix known patterns, for example BBC `/ace/branded_news/` → `/ace/standard/` (verify during M8).
- Validate the top 3 by actually loading them (§6.3 loader), then store their real dimensions. Templates prefer the validated image whose aspect is closest to the image slot.
- Deduplicate by URL. Keep query-distinct variants when the query defines the crop.

**URLs**

- `canonical` = `link[rel=canonical]` → `og:url` → `ld.url` → final URL.
- Ignore the canonical if its path is `/` while the input path is deeper (misconfigured). If it's cross-domain and not in the registry's domain list, keep the final URL as the default and offer the canonical as an alternative.
- AMP input (`/amp/`, `.amp`, an `amp.` subdomain, `outputType=amp`, `google.com/amp/s/…`, `*.cdn.ampproject.org/c/s/…`) → use the canonical.
- Clean the citation URL (§5.6.4).
- Display styles: **clean** (default; drop the scheme and `www.`), **full**, **domain**. Long URLs are ellipsised in the middle at render time.

**Language and direction**

- Precedence: `og:locale` / `ld.inLanguage` (if they agree) → `html[lang]` → registry → none.
- *Observed:* an Italian Repubblica article declared `lang="en"`, so prefer `og:locale`/`inLanguage` when they disagree with `html[lang]`.
- `dir` is `rtl` if the primary subtag is one of `ar`, `arc`, `ckb`, `dv`, `fa`, `he`, `iw`, `ps`, `sd`, `ug`, `ur` or `yi`, **or** if most letters in the title are in Arabic or Hebrew script.
- Date locale defaults to the **user's** `navigator.language`, so a deck stays consistent. Option: "Match article language" or any locale.

### 5.6 Normalisation utilities (`core/url.ts`, `core/text.ts`)

**5.6.1 Input URL**

1. Trim, then take the first URL in the pasted text (people paste "Title — https://…").
2. Add `https://` if the text looks like a domain.
3. Unwrap redirect wrappers: `google.com/url?q=`, `l.facebook.com/l.php?u=`, `lm.facebook.com`, `google.com/amp/s/`, `*.cdn.ampproject.org/c/s/`.
4. Leave `news.google.com` links to the proxy's redirect handling, and warn if that fails (they're JS redirects).
5. Reject anything that isn't http(s).

**5.6.2 Text**

NFC-normalise, decode entities (double-encoded too), remove zero-width characters and soft hyphens, collapse whitespace, trim. Leave quote styles exactly as the source has them.

**5.6.3 Title suffix stripping**

```
seps   = [' | ', ' - ', ' – ', ' — ', ' · ', ' • ', ' :: ', ' » ', ' / ']
noise  = siteName candidates ∪ host labels ("ansa", "ansa.it", "repubblica") ∪ section values
         ∪ registry.titleSuffixes ∪ {"home", "news", "latest news"}
match  = case- and diacritic-insensitive, leading articles ignored (the/la/il/der/el/le), substring of a host label counts
1. If an anchor exists (validated h1 or ld.headline) and candidate == anchor + sep + rest → return anchor.
2. Split candidate on seps; while segments > 1 and last segment matches noise → drop it.
3. Never strip from the front ("Opinion | …" is a kicker; keep it and let the user edit).
4. Keep the result only if it retains ≥ 3 words or ≥ 50% of the original length.
```

*Observed* suffixes this must handle: ANSA's `og:title` ends with "- Ultima ora - Ansa.it" (section plus domain), Corriere's with "| <column author>" (handled by the h1 anchor), TechCrunch's with "| TechCrunch". Al Jazeera's `<title>` ends with "| Space News | Al Jazeera".

**5.6.4 Citation URL cleaning**

Prefer the canonical. Then remove tracking parameters (Appendix B.1) and the fragment (*observed*: `#ref=rss`), and keep every other query parameter (HN needs `?id=`).

**5.6.5 Same-site checks**

Wherever this plan says "same site" or "cross-domain", compare an approximate registrable domain: the last two host labels, or the last three when the second-to-last label is a common second-level suffix (`co`, `com`, `org`, `net`, `gov`, `ac`, `edu`, as in `bbc.co.uk`). Don't bundle the full Public Suffix List.

### 5.7 Detecting blocked and low-quality pages (`core/blocked.ts`)

A page is **blocked** if any of these holds:

- The upstream status is in {401, 402, 403, 407, 429, 451, 503} **and** there's no structured title (`og` or `ld`).
- `<title>` matches a challenge pattern (Appendix B.3), *observed* examples: "Just a moment...", "Security Verification", "Accès restreint – Le Monde", and a **bare hostname** such as "nytimes.com" or "wsj.com" (DataDome).
- The body contains challenge markers: `captcha-delivery.com`, `challenges.cloudflare.com`, `/cdn-cgi/challenge-platform/`, `cf-chl-`, `_Incapsula_Resource`, `px-captcha`, `perimeterx`, `datadome`.
- The final host starts with `consent.`, or the path gained `/consent` (a cookie wall).

Classify the block for UX copy: `challenge`, `paywall-wall` (402), `geo` (451), `consent-wall`, `not-html`, `no-metadata`.

**Quality score** (0–1): structured title 0.4, image 0.2, date 0.15, description 0.15, site name 0.1. Run the fallbacks when the page is blocked **or** has no structured title.

### 5.8 Fallbacks and orchestration

1. **Direct, via the proxy.** Always first, unless an adapter matches. If the registry marks the outlet `fetch: "blocked"`, start the fallbacks in parallel with the direct fetch. The client aborts `/api/text` after 12 s and retries once, after 1 s, on `502` or `504`.
2. **If blocked or untitled**, run these in parallel, each with a 6 s timeout:
   - **(a) Feed match** (`net/feedmatch.ts` + `core/feeds.ts`).
     - Feeds = registry `feeds` ∪ `link[rel=alternate]` RSS/Atom links from any HTML we have ∪ homepage autodiscovery (fetch `https://<host>/` through the proxy, at most 3 feeds).
     - Parse RSS 2.0, Atom or RDF with `DOMParser('application/xml')`.
     - Match items by normalised URL (scheme- and `www`-insensitive, no query, fragment or trailing slash) against `link`, `guid` (if it's a URL) and `atom:link[rel=alternate]`. Then try ID tokens: an FT `guid` is a UUID that appears in the article URL.
     - Map title, `description` (HTML stripped), `pubDate`/`updated`/`dc:date`, `dc:creator`, `category`, and `media:content`/`media:thumbnail`/`enclosure` images.
     - *Observed:* the feeds of The Economist, NYT, WSJ, Le Monde and FT all loaded without challenges and contained the tested articles, with title, description and date. NYT, Le Monde and FT also had an image. The Economist's had none.
   - **(b) Wayback.**
     - Call `GET https://archive.org/wayback/available?url=<url>` from the browser (CORS `*`, *verified*).
     - If a snapshot exists, fetch `https://web.archive.org/web/<timestamp>id_/<url>` through the proxy. The `id_` form returns the original bytes without the archive toolbar. Run the same extractor on it at 0.9× its normal base scores.
     - Provenance label: "Internet Archive snapshot, <date>". If a direct image load fails, retry it as `/web/<ts>im_/<imageUrl>`.
     - *Observed:* snapshots existed for FT, Le Monde and WSJ articles, but not for Economist and NYT articles less than a day old.
3. **Merge** the candidates and set `status = 'partial'` (or `'ok'` if everything essential was found). Show the provenance banner with the user-driven options.
4. **User-driven sources** each replace the direct result entirely, while images and manifests still go through the proxy:
   - Bookmarklet payload (§11).
   - Paste page source (textarea) or drop an `.html` file. Ask for the URL if the HTML has no canonical or `og:url`.
   - Manual entry (§9.2, "Start from scratch").

**Hacker News adapter** (`net/adapters/hn.ts`, in MVP)

- Match `^https?://news\.ycombinator\.com/item\?id=(\d+)` and fetch `https://hacker-news.firebaseio.com/v0/item/<id>.json` directly (CORS is reflected, *verified*). HN pages have **no** metadata beyond `<title>` (*observed*).
- Map the fields:
  - `title` → headline
  - "Show HN", "Ask HN", "Launch HN" and "Tell HN" prefixes → kicker
  - `by` → author
  - `time` (epoch, UTC) → date
  - the domain of `url` → subtitle ("mitchellh.com")
  - `score` / `descendants` → extras
  - site name "Hacker News", logo `https://news.ycombinator.com/y18.svg` (through the proxy), brand colour `#FF6600`
- Offer **"Use linked article's image"**: run the generic pipeline on `item.url` and merge in only its image.
- Comments (`type: comment`) aren't supported in MVP. Show "This is a comment, open its story instead", linking to the parent.

### 5.9 Data model (`core/types.ts`)

```ts
export type SourceId = 'adapter'|'jsonld'|'og'|'twitter'|'article'|'microdata'|'parsely'|'sailthru'|'dc'
  |'citation'|'meta'|'html'|'link'|'manifest'|'feed'|'wayback'|'registry'|'url'|'heuristic'|'user';

export interface Candidate<T> { value: T; source: SourceId; score: number; note?: string }
export interface PartialDate { raw: string; y: number; m: number; d: number; hh?: number; mi?: number; offsetMin: number | null }
export interface ImageRef { url: string; width?: number; height?: number; alt?: string; mime?: string }
export type LogoKind = 'wordmark' | 'icon' | 'favicon' | 'monogram';
export interface LogoRef extends ImageRef { kind: LogoKind; svgMarkup?: string; tint?: string }

export interface Extraction {                       // output of pure extract()
  pageUrl: string; lang?: string; dir?: 'ltr' | 'rtl';
  title: Candidate<string>[]; description: Candidate<string>[]; kicker: Candidate<string>[];
  siteName: Candidate<string>[]; authors: Candidate<string[]>[];
  published: Candidate<PartialDate>[]; modified: Candidate<PartialDate>[];
  images: Candidate<ImageRef>[]; logos: Candidate<LogoRef>[]; colors: Candidate<string>[];
  canonical: Candidate<string>[];
  links: { manifest?: string; feeds: string[]; oembed?: string; amp?: string };
  flags: { isAccessibleForFree?: boolean; ogType?: string };
  warnings: string[];
}

export interface Field<T> { value: T | null; options: Candidate<T>[]; override?: T | null } // override = user edit
export interface LoadedImage { ref: ImageRef; objectUrl: string; width: number; height: number; palette?: string[] }
export interface LoadedLogo { ref: LogoRef; objectUrl: string; width: number; height: number; analysis: LogoAnalysis }

export interface ArticleModel {
  inputUrl: string; finalUrl: string; citeUrl: string;
  provenance: Array<'proxy'|'adapter'|'feed'|'wayback'|'bookmarklet'|'paste'|'manual'>;
  status: 'ok' | 'partial' | 'blocked'; blockReason?: string;
  fields: { title: Field<string>; description: Field<string>; kicker: Field<string>; siteName: Field<string>;
            authors: Field<string[]>; published: Field<PartialDate>; modified: Field<PartialDate>;
            image: Field<LoadedImage>; logo: Field<LoadedLogo> };
  brand: { outletId?: string; color?: string; paper?: string; palette: string[] };
  lang?: string; dir: 'ltr' | 'rtl';
  extras?: { hn?: { points: number; comments: number; by: string; linkUrl?: string } };
}
```

---

## 6. Brand: logos and colours

### 6.1 Outlet registry (`web/src/brand/outlets.json`)

This file is **data only** (no code), changed through PRs and checked by `npm run registry:check` (`scripts/registry-check.ts` loads every logo and feed URL through the proxy and reports failures; it also runs in the weekly smoke job).

```jsonc
{
  "id": "guardian",
  "name": "The Guardian",
  "domains": ["theguardian.com", "guardian.co.uk"],        // host or any subdomain matches
  "colors": { "brand": "#052962", "paper": null },
  "logo": {
    "wordmark": { "url": "https://…", "onDark": "mono", "onLight": "original" },
    "icon":     { "url": "https://…" }
  },
  "fonts": { "headline": "serif" },                          // category hint: serif | sans
  "feeds": ["https://www.theguardian.com/world/rss"],
  "titleSuffixes": ["| The Guardian"],
  "imageRewrites": [{ "pattern": "…regex…", "replace": "…" }],
  "fetch": "ok",                                             // "blocked" → start fallbacks in parallel
  "verified": "2026-11-07"
}
```

- Logos are **referenced by URL** and loaded through the image proxy. Prefer the outlet's own SVG (found in its page header), then a Wikimedia Commons file URL. Don't bundle third-party logo files in the repo.
- **MVP seed (10):** The Economist, The New York Times, The Guardian, BBC News, Financial Times, 404 Media, Hacker News, The Verge, Il Post, Corriere della Sera.
- **v1.0 seed (~35):** add The Washington Post, The Wall Street Journal, Bloomberg, Reuters, Associated Press, Al Jazeera, The Atlantic, The New Yorker, Wired, Ars Technica, TechCrunch, MIT Technology Review, Nature, Science, Politico, Axios, NPR, CNN, Le Monde, El País, DER SPIEGEL, la Repubblica, Il Sole 24 ORE, ANSA, Süddeutsche Zeitung.
- **Colours observed on 2026-11-07** (use as-is):

  | Outlet | Colours |
  |---|---|
  | The Guardian | `#052962` (theme-color and manifest) |
  | DER SPIEGEL | `#E64415`, dark variant `#D03D12` |
  | 404 Media | `#E50B4F` (manifest; the meta theme-color is `#000000`) |
  | BBC News | `#BB1919` (`msapplication-TileColor`) |
  | Il Sole 24 ORE | paper `#F5E5D5`, blue `#003C7F` (mask-icon) |
  | Hacker News | `#FF6600` |

  **Don't guess the others.** Read them from the outlet's manifest, theme-color or mask-icon, or from its official brand page, during M8.
- Mark The Economist, FT, NYT, WSJ, Le Monde and WaPo as `fetch: "blocked"`, and give each a working `feeds` list.

### 6.2 Logo candidates and ranking

| Source | Kind | Base |
|---|---|---|
| Registry wordmark / icon | wordmark / icon | 1.0 / 0.9 |
| Header logo (§ below) | wordmark if aspect ≥ 1.8, else icon | 0.8 |
| `ld` `publisher.logo` / `Organization.logo` | by aspect | 0.7 × validation |
| `mask-icon` SVG (monochrome, with a `color` tint) | icon | 0.65 |
| Manifest icons (largest `purpose: any`, ≥ 192 px; resolve relative to the manifest URL) | icon | 0.6 |
| `apple-touch-icon` (largest) | icon | 0.55 |
| `link[rel~=icon]` (SVG, or largest ≥ 64 px) | favicon | 0.5 |
| `/favicon.ico` | favicon | 0.3 |
| Google favicon service (off by default, privacy setting) | favicon | 0.25 |
| Monogram (first letter on the brand colour, generated) | monogram | 0.1 |

*Observed:* JSON-LD publisher logos were junk for several outlets:

- BBC: a 1024×576 poster
- El País: a 379×975 newsletter image
- The Verge: a placeholder
- Wired: a newsletter JPG

Header SVG wordmarks, by contrast, were excellent on El País, TechCrunch, Wired, ITmedia and Repubblica. That's why header logos rank above `ld` logos and **every logo is validated**.

**Header logo heuristics** (`core/extract/dom.ts`, needs full HTML)

- **Scope:** the first `header`, `[role=banner]`, `#header`, `.header`, `.masthead`, `.site-header` or `nav` in DOM order. Otherwise, the first ~150 elements of `body`.
- **Elements:** `img`, `picture source[srcset]`, inline `svg`, children of `a[href="/"]` or of a link to the homepage.
- **Positive signals:**
  - attributes (`class`, `id`, `alt`, `aria-label`, `title`, `src`, `data-*`) matching `/logo|brand|masthead|wordmark/i`
  - `alt`/`aria-label` equal to the site name
  - wrapped in a link to the homepage
  - early in the DOM
- **Negative signals:** `/footer|partner|sponsor|promo|coupon|social|facebook|twitter|whatsapp|newsletter|app-?store|google-?play|avatar|author|search|menu/i` (*observed*: Wired coupon logos, Nature sub-brand logos, Corriere social icons). A declared height under 16 px is also negative.
- **Inline SVG serialisation:**
  - Add `xmlns`.
  - Inline any `<use href="#id">` targets: copy the referenced `<symbol>`/`<g>` from the document.
  - Strip `<script>`, `<foreignObject>`, `on*` attributes, external `href`s and `@import`.
  - Require a `viewBox` or `width` + `height`, and set explicit `width`/`height` from the `viewBox`, because Firefox reports 0 natural size otherwise.
  - Cap at 100 KB.
- For `img`, use the largest `srcset` entry, then `data-src`, then `src`. `data:` URLs are fine.

### 6.3 Logo validation and analysis (`brand/logo.ts`)

**Loader** (`net/images.ts`, shared by images and logos)

1. `fetch(proxy('/api/image', url))`
2. `blob()`
3. `URL.createObjectURL`
4. `img.decode()`

This gives real dimensions with no canvas taint, because the result is a same-origin blob. Revoke object URLs when they're replaced.

**Analysis** (draw at most 256 px into a canvas) produces `LogoAnalysis`. If drawing an SVG taints the canvas (older WebKit), skip the analysis and treat the logo as valid with unknown colours.

```ts
interface LogoAnalysis { aspect: number; alphaCoverage: number; bgColor?: string; colors: string[];
                         isMonochrome: boolean; fgLuminance: number; entropy: number }
```

The fields:

- `aspect`
- `alphaCoverage`
- `bgColor`: set if all four corners are opaque and similar (ΔE < 5)
- `colors`: top 3 k-means clusters in OKLab, ignoring transparent pixels and the background
- `isMonochrome`: at least 90% of foreground pixels in one cluster
- `fgLuminance`
- `entropy`

**Reject** a logo if:

- it fails to load
- it's under 24 px tall
- it looks like a photo (high entropy and more than 6 significant clusters)
- it's portrait (aspect < 0.5)

Validate candidates in score order, at most 4, and stop once one wordmark and one icon have passed.

### 6.4 Logo treatments

- **original:** drawn as-is. If the logo has an opaque background (an app-icon style), render it with rounded corners (22%).
- **mono:** recolour on a canvas. Draw the logo, set `globalCompositeOperation = 'source-in'`, fill with the target colour, and export a PNG data URL. Rasterise SVGs at ≥ 1024 px wide first. Cache by `(logo, colour)`. This works the same for raster and SVG logos and exports reliably (avoid CSS `mask-image`).
- **auto** (default):
  - On Dark, Brand and Image themes, use mono in the theme's ink colour, unless the logo has an opaque background (then original).
  - On Light and Paper, use original, unless the logo's foreground luminance is above 0.8, i.e. a white logo (then mono dark).
  - Registry `onDark` / `onLight` settings override this.

### 6.5 Brand colour

**Candidates**

| Source | Base |
|---|---|
| registry `brand` | 1.0 |
| manifest `theme_color` | 0.8 |
| meta `theme-color` (prefer `media` light) | 0.75 |
| `mask-icon` `color` | 0.7 |
| `msapplication-TileColor` | 0.65 |
| dominant non-neutral logo colour | 0.6 |
| manifest `background_color` | 0.5 |
| most vibrant cluster of the featured image | 0.3 |

- Neutral values (OKLCH chroma < 0.03, or L > 0.97, or L < 0.12) are not brand accents. Keep them as `paper` hints instead (for example Il Sole 24 ORE's `#F5E5D5`).
- *Observed:* 404 Media's meta theme-color is `#000000`, but its manifest says `#E50B4F`. **So always fetch the manifest** (`/api/text`, parse the JSON, resolve URLs relative to the manifest URL).

### 6.6 Theme generation (`brand/theme.ts`, culori OKLCH + WCAG 2 contrast)

| Theme | Tokens |
|---|---|
| Light (default) | bg `#FFFFFF`, ink `#111111`, muted `#5B5B66`, rule `#E6E6EA`, accent = brand with OKLCH L lowered until contrast with bg ≥ 4.5 |
| Dark | bg `#121214`, ink `#F4F4F5`, muted `#A1A1AA`, rule `#2A2A2E`, accent = brand with L raised until contrast ≥ 4.5 |
| Brand | bg = brand, ink = white or `#111` (whichever has more contrast; nudge bg L if neither reaches 4.5), muted = ink at 72%, accent = ink |
| Paper | bg = registry paper or `#F6F1E7`, ink `#1B1B1B`, serif headline by default, accent = brand adjusted for contrast |
| Image (v1.0) | k-means on a 64×64 thumbnail of the featured image: bg = darkest muted cluster with L clamped to 0.18–0.28 and C ≤ 0.06, ink `#F7F7F8`, accent = most vibrant cluster raised to contrast ≥ 4.5 |
| Mono | black on white (or inverted), images greyscale, logos mono |

Tokens become CSS variables on the card root: `--bg --ink --muted --rule --accent --accent-ink --scrim`.

---

## 7. Card rendering

### 7.1 Approach

- `renderCard(model, style): HTMLElement` builds the card with a tiny `h(tag, attrs, children)` helper.
  - **Extracted text only ever goes in through `textContent`.**
  - Images use blob or data URLs only.
  - A CI guard (`scripts/check-no-innerhtml.ts`) fails the build if `innerHTML`/`outerHTML =`/`insertAdjacentHTML` appear in `web/src` outside an allowlist.
- Card root: `<article class="nc-card nc-t-classic" lang dir style="--w:1200px; --u:12px">`. Every template dimension is a multiple of **`--u` = width / 100** (in px, set from JS), so the card scales with its width without container queries.
- Logical width defaults to **1200**.
- **Preview:** a `.stage-scaler` with `transform: scale(s)`, where `s = min(1, availableW / cardW, availableH / cardH)`. Its wrapper is sized to the scaled dimensions. Export always captures the unscaled node.
- **Frame:** the optional `.nc-frame` wrapper (§7.6). The export target is the frame when it's enabled, otherwise the card.

### 7.2 Templates

All templates share these parts: **Masthead** (wordmark, or icon + site name), **Kicker**, **Headline**, **Subtitle**, **Meta line** (date · author · URL), **Image**, and an optional **QR** code (extras).

| Template | Phase | Spec |
|---|---|---|
| **Classic** | MVP | Image full-bleed at the top (auto height: 1.91:1, with a 16:9 option; fixed sizes: about 50% of the height in landscape, 45% in square), then a 5u-padded body. Masthead row: wordmark 3.2u tall, or icon 4u + name 2u bold. Kicker 1.5u, uppercase, tracking 0.08em, accent colour. Headline 4.4u, line height 1.12, weight 650 sans / 600 serif, `text-wrap: balance`. Subtitle 2.1u, line height 1.4, muted, at most 3 lines. Hairline rule. Meta row 1.5u muted: date · author on the start side, URL on the end side, ellipsised |
| **Split** | MVP | Landscape first. Image fills 42% of the width on the end side (option: start side) at full height, `object-fit: cover`. The text column is vertically centred: masthead at the top, headline and subtitle in the middle, meta at the bottom. In auto height, min height is 0.5 × width. Portrait sizes fall back to the Classic structure |
| **Headline** | MVP | No image. Masthead at the top, then kicker, a big headline (fitted 5–8u), optional subtitle, and meta at the bottom. Optional accent bar 0.6u wide on the start edge. Looks great with the Brand theme |
| **Hero** | extras | Full-bleed image with a scrim gradient (transparent → `rgba(0,0,0,.82)` over the bottom 65%). White text bottom-start, mono-white logo top-start. Best at 1:1, 4:5 and 9:16 |
| **Browser** | extras | Window chrome (3u bar, three 1.1u dots, an address pill with a lock icon, favicon and clean URL in mono 1.4u) wrapped around Classic content. A nod to carbon |
| **Strip** | extras | Compact citation row for slide footers, 14–18u tall: icon square 8u, site · date (1.4u muted), headline 2.6u (at most 2 lines), optional 16u×9u thumbnail |

The registry can set per-outlet defaults (theme, headline font category). For example, HN gets the Brand theme in `#FF6600`, a system sans font, and a "412 points · 113 comments" meta line.

### 7.3 Sizes

| Preset | Logical size |
|---|---|
| **Auto** (default) | width 1200 (slider 600–2000), height follows the content |
| 16:9 | 1200×675 |
| 4:3 | 1200×900 |
| 3:2 | 1200×800 |
| 1.91:1 (OG) | 1200×628 |
| 2:1 | 1200×600 |
| 1:1 | 1080×1080 |
| 4:5 | 1080×1350 |
| 9:16 | 1080×1920 |
| Custom | W and H each 320–4000 |

The export panel always shows the final pixel size (logical size × scale).

### 7.4 Fitting text (`render/fit.ts`)

- **Fixed sizes:**
  1. After every render or content/style change (debounced to one `requestAnimationFrame`), and only after `document.fonts.load()` has resolved for the active faces: binary-search the headline font size between the template's `minU` and `maxU` (Classic: 2.8u–5.2u), at most 8 iterations, until the text column's `scrollHeight ≤ clientHeight`.
  2. Clamp the subtitle to the lines that fit (0–3, `-webkit-line-clamp`).
  3. If it still overflows at the minimum size, **drop optional fields in priority order**: subtitle → kicker → author. Never drop the headline, the masthead, or a date/URL the user has switched on.
  4. Tell the user what was hidden ("Subtitle hidden to fit — try Auto height or a taller size").
- **Auto height:** headline size = template default × `headlineScale`. Only the subtitle is clamped.
- `headlineScale` (80–125%) multiplies the result in both modes.
- Re-run fitting on `document.fonts.onloadingdone`.

### 7.5 Typography

- Font families:

  | Family | Role |
  |---|---|
  | **Newsreader** | serif with optical sizes, built for news; default headline unless the registry hint says sans |
  | Source Serif 4 | alternative serif |
  | **Inter Tight** | display sans |
  | **Inter** | body and meta text |
  | JetBrains Mono | optional mono meta and URL |
  | "System" | `system-ui` stack |

- `type FontId = 'newsreader' | 'source-serif' | 'inter' | 'inter-tight' | 'jetbrains-mono' | 'system'`.
- Fontsource CSS ships `unicode-range` subsets, so browsers download only what's needed.
- Fallback stacks must cover CJK, Arabic, Hebrew and emoji:
  - `…, "Hiragino Sans", "Noto Sans CJK JP", "PingFang SC", "Noto Sans Arabic", "Noto Sans Hebrew", sans-serif`
  - serif equivalents for the serif families
  - `"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"`

### 7.6 Frame (carbon-style)

- **Off by default.** Copy then gives you the bare card with transparent rounded corners, which is ideal on slides.
- When it's on:
  - **Padding:** 0–20u (default 6u).
  - **Background:**
    - transparent, solid, or one of 8 curated gradients ("Graphite", "Ink", "Dusk", "Paper", "Sunset", "Aurora", …)
    - **Brand:** brand colour → 25% darker with hue +15°
    - **Blur:** the featured image, scaled 1.2×, blurred and dimmed. **Pre-blur it on a canvas into a data URL** rather than using CSS `filter`, which is unreliable in exports.
  - **Shadow:** none, soft (`0 1.2u 3.6u rgba(0,0,0,.18)`), medium or strong.
- Corner radius 0–4u (default 1.6u) applies to the card itself.

### 7.7 Internationalisation

- The card root gets `lang` and `dir` from the model. Templates use logical CSS properties (`margin-inline-start`, `text-align: start`), so RTL mirrors automatically.
- Long URLs use `overflow-wrap: anywhere`. CJK uses `line-break: strict`. `text-wrap: balance` is supported in Chrome 114+, Firefox 121+ and Safari 17.5+, and is harmless elsewhere.
- Fixtures must include Japanese (*observed*: ITmedia), Arabic, Hebrew, long German compounds, Italian accents, and an emoji in a headline.

---

## 8. Export

### 8.1 Capture (`export/capture.ts`)

- Expose one function, `renderToBlob(node, { scale, type, quality, background }) → Promise<Blob>`, implemented with `modern-screenshot`'s `domToBlob`. Keep it thin so `@zumer/snapdom` can replace it after the M5 spike.
- Before capturing:
  - `await document.fonts.ready`
  - `await img.decode()` for every image in the node (they're blob or data URLs, so nothing is tainted)
  - pass only the active `@font-face` CSS for embedding (precompute it per font combination), not every font on the page
- **Safari:** do one warm-up capture right after the first render and throw it away, to work around images or fonts missing from the first draw. Verify this with Playwright WebKit **and** real Safari.
- **Scale:** default 2×. Clamp so that `w × h × scale² ≤ 16,777,216` on iOS/iPadOS Safari (its canvas area limit) and ≤ 50 M elsewhere. Show the adjusted size if clamping kicks in.
- **Pre-render cache:** after 600 ms idle, render the PNG in the background and keep `{ stateHash, blob }`. Copy and Download reuse it when the hash matches.

### 8.2 Copy

```ts
copyButton.addEventListener('click', () => {
  // The ClipboardItem MUST be constructed synchronously inside the user gesture.
  const png: Promise<Blob> = cachedPngFor(currentStateHash()) ?? renderToBlob(exportTarget(), { type: 'image/png', scale });
  navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).then(
    () => toast(`Copied ${pxW}×${pxH} PNG`),
    (err) => openCopyFallback(png, err),   // dialog with the <img> (right-click → Copy Image) + Download button
  );
});
```

- Support (*verified* in MDN compat data):
  - Chrome accepts a Promise for the item since 98, with the full constructor since 133.
  - Firefox has had `ClipboardItem` and `clipboard.write` since 127.
  - Safari has had them since 13.1.
  - Each `write()` takes one `ClipboardItem`. It must run inside a user gesture (Chrome ≥ 107, Firefox). The only image type is `image/png`.
- **Feature detection:** `'ClipboardItem' in window && !!navigator.clipboard?.write`, plus `ClipboardItem.supports?.('image/png')` where available. Without support, hide Copy and make Download primary.

### 8.3 Download

- PNG (default), JPEG (quality 0.92; filled with the frame or theme background, because JPEG has no alpha) or WebP.
- File name `{outlet-slug}-{yyyy-mm-dd}-{first-6-words-of-headline}.{ext}`, ASCII-folded, at most 80 chars, for example `the-guardian-2026-11-06-kenyan-doomsday-sect-leader-jailed.png`.
- Download through an `<a download>` and an object URL, revoked afterwards. On mobile, offer **Share…** when `navigator.canShare({ files })`.

### 8.4 Pitfalls checklist

- iOS canvas limit.
- Firefox's user-gesture rule.
- Safari's first capture.
- Avoid `backdrop-filter`, CSS `filter`, `mask-image` and blend modes in cards. Pre-bake those effects on a canvas instead.
- `text-wrap: balance` must survive cloning. Check it in visual tests, and if a library drops it, add a JS balancing fallback (binary-search `max-width`).

---

## 9. App UI/UX (dark and minimal)

### 9.1 Design tokens (`ui/styles/tokens.css`)

| Token | Value |
|---|---|
| `--bg` | `#0A0A0B` |
| `--panel` | `#0F0F11` |
| `--raised` | `#16161A` |
| `--border` | `#232327` |
| `--border-strong` | `#2E2E34` |
| `--text` | `#EDEDEF` |
| `--text-muted` | `#9A9AA3` |
| `--text-subtle` | `#6B6B74` |
| `--primary-bg` / `--primary-text` | `#F5F5F7` / `#0A0A0B` |
| `--danger` | `#F87171` |
| `--success` | `#4ADE80` |
| `--focus` | `0 0 0 3px rgba(255,255,255,.16)` |

- Radii 10 and 14 px, on a 4 px spacing grid.
- UI font: Inter Variable 14px/1.45. URLs in JetBrains Mono.
- Motion: 160 ms `cubic-bezier(.2,.8,.2,1)`, respecting `prefers-reduced-motion`.
- `color-scheme: dark`.
- The UI is dark only. Cards have their own light and dark themes.
- Icons: about a dozen inline SVGs (Lucide, MIT), no icon font.
- Minimal ornament: no gradients in the chrome. The only colour is the outlet accent, as a faint 1 px ring around the preview.

### 9.2 Landing page (`ui/landing.ts`)

- A centred column, max 640 px wide, sitting at about 40% of the viewport height.
  - Wordmark "News Card Maker" (15 px / 600).
  - A muted tagline: "Turn a news link into a clean, citable card for your slides."
  - **Input:** 56 px tall, radius 14, `--panel` background, placeholder "Paste a news article link…", autofocused. Inside it on the right, a primary button "Create ↵", enabled once the text looks like a URL.
  - Below: "Try:" and 3 **example chips**, real and stable article URLs chosen at implementation time (one HN item, one Ghost or WordPress outlet, one Italian outlet). They go through the normal pipeline; **never fabricate sample articles**.
  - Small muted links: **Use the bookmarklet** · **Paste page source** · **Start from scratch** (manual mode with a registry outlet picker).
  - **Recent** cards (v1.0): history thumbnails.
- **Global paste:** pasting text that contains a URL anywhere on the page (outside a field) fills the input and submits.
- Footer: "Open source · No tracking · Logos and headlines belong to their publishers" + GitHub icon.

### 9.3 Editor (`ui/editor.ts`)

- **Desktop (≥ 1024 px):**
  - **Top bar** (52 px): wordmark (back to the landing page), a compact URL field (shows `citeUrl`; Enter reloads), and on the right New, Bookmarklet and Help (`?`).
  - **Stage** (flexible width): dark background with a faint dot grid and a checkerboard behind transparent areas, the preview centred.
    - **Status line** under the preview: provenance and warnings, for example "Loaded from The Economist's RSS feed · image unavailable · [Add image]".
    - **Action bar:** **Copy image** (primary), **Download ▾** (PNG, JPEG, WebP), **⋯** (Copy link to this card, Open original, and later Copy citation and Copy alt text). Pixel readout, e.g. "2400 × 1350 px".
  - **Panel** (360 px, scrolls): collapsible sections Content, Layout, Style, Frame, Export.
- **Below 1024 px:** the stage goes on top at full width, the action bar sticks to the bottom, and the panel becomes a bottom sheet with tabs.
- **Progressive loading:** a shimmer skeleton in the Classic layout, with fields fading in as they arrive. Clicking a text element in the preview focuses its field in the panel. Dragging the image in the preview moves its focal point.

### 9.4 Controls (schema-driven, `ui/controls/schema.ts`)

Each control is declared as `{ id, label, type, path, options?, visibleIf?, help? }`, where `type` is one of `text | textarea | select | segmented | toggle | slider | color | swatches | candidates | date | file`. The panel renders entirely from this schema.

| Section | Controls (default) |
|---|---|
| Content | Headline (textarea + **Alternatives** menu labelled by source: "Page headline", "Social title", "SEO title", "Structured data", "RSS"; highlight button in extras) · Subtitle (on if present; alternatives) · Kicker (off) · Outlet name (auto: shown with an icon, favicon or monogram, hidden with a wordmark) · Logo (candidate strip, upload, none) · Image (candidates, upload / drop / paste from clipboard, none; zoom 1–2.5) · Authors (off) · Published date (on; date input) · Updated (off) · Accessed today (off) · URL (on; style clean / full / domain) · Date format (medium) + locale (browser) |
| Layout | Template (thumbnails) · Size (preset + custom W×H; Auto) · Width (Auto mode) · Image position (top / start / end, where it applies) · Alignment (start / centre) · Density (compact / regular / airy) · Headline size (100%) |
| Style | Theme (**Light**) · Accent (swatches from brand + palette + picker; auto) · Headline font (auto from registry, else Newsreader) · Body font (Inter) · Corner radius (1.6u) · Border (none) · Logo style (auto) · Image filter (none; greyscale / dim; duotone in extras) |
| Frame | Enabled (**off**) · Background · Padding · Shadow |
| Export | Format (PNG) · Scale (**2×**) · JPEG quality · File-name preview |

### 9.5 States and copy

| State | UI |
|---|---|
| Loading | Skeleton card plus "Reading {host}…" (after 4 s: "Still trying — some sites are slow") |
| Partial (fallback) | Card plus status: "{Outlet} blocks automated reading. We used its RSS feed." Actions: Bookmarklet · Paste source · Add image |
| Blocked, nothing found | Empty state: "{Outlet} didn't let us read this page automatically. That's common with sites that use bot protection." Primary: **Use the bookmarklet** (works on any page you can open). Secondary: Paste page source · Fill in manually |
| Consent / geo wall | Same as blocked, with a specific first sentence |
| Not an article / no metadata | "We couldn't find a headline on this page." Offer manual mode, prefilled with whatever was found |
| Proxy down / network | "The fetch service is unavailable. Try again in a minute, or paste the page source." |
| Invalid input | Inline under the input: "Paste a full link, starting with https://" |

### 9.6 Keyboard and accessibility

- **Shortcuts:**
  - `/` or `Ctrl/⌘ L`: focus the URL field
  - `Enter`: create
  - `Ctrl/⌘ V` with no field focused: paste and create
  - `Ctrl/⌘ C` with no text selected and no field focused: copy the card
  - `Ctrl/⌘ S`: download
  - `?`: shortcuts help
- Every control is labelled. Toasts and status go to an `aria-live="polite"` region. The preview has `role="img"` and an `aria-label` equal to the generated alt text.
- Visible focus rings, contrast of at least 4.5, full keyboard operation, reduced motion respected.

---

## 10. State, persistence and URL scheme

- **Store** (`state/store.ts`, about 40 lines): `get()`, `set(updater)`, `subscribe(selector, cb)`. Rendering is batched with `requestAnimationFrame`.

```ts
interface AppState {
  phase: 'landing' | 'loading' | 'editing';
  input: { url: string; source: 'url' | 'bookmarklet' | 'paste' | 'manual' };
  article: ArticleModel | null;
  style: CardStyle;
  ui: { panelSection: string; toasts: Toast[]; dialog: DialogId | null };
}
interface CardStyle {
  v: 1;
  template: 'classic' | 'split' | 'headline' | 'hero' | 'browser' | 'strip';      // 'classic'
  size: { preset: 'auto'|'16:9'|'4:3'|'3:2'|'1.91:1'|'2:1'|'1:1'|'4:5'|'9:16'|'custom'; width: number; height: number | null }; // auto, 1200
  theme: 'light' | 'dark' | 'brand' | 'paper' | 'image' | 'mono';                  // 'light'
  accent: string | null;                         // null = auto (brand)
  fonts: { headline: 'auto' | FontId; body: FontId };
  headlineScale: number; align: 'start' | 'center'; density: 'compact' | 'regular' | 'airy';
  radius: number; border: 'none' | 'hairline'; logoStyle: 'auto' | 'original' | 'mono';
  imageFilter: 'none' | 'grayscale' | 'dim' | 'duotone'; imageFocus: { x: number; y: number }; imageZoom: number;
  imagePosition: 'top' | 'start' | 'end';
  show: { image: boolean; logo: boolean; siteName: 'auto' | boolean; kicker: boolean; description: boolean;
          authors: boolean; date: boolean; updated: boolean; accessed: boolean; url: boolean; qr: boolean };
  urlStyle: 'clean' | 'full' | 'domain'; dateFormat: 'long' | 'medium' | 'short' | 'iso'; locale: 'auto' | 'article' | string;
  frame: { enabled: boolean; background: { kind: 'transparent'|'solid'|'gradient'|'brand'|'blur'; value?: string }; padding: number; shadow: 'none'|'soft'|'medium'|'strong' };
  export: { format: 'png' | 'jpeg' | 'webp'; scale: 1 | 2 | 3 | 4; quality: number };
}
```

- **URL state:** `?url=<encoded>` loads automatically, which makes the simplest bookmarklet and launcher integrations work. `#s=<base64url(JSON)>` holds the style fields that differ from the defaults, plus short text overrides (under 1 KB). It's written with `history.replaceState`, debounced 400 ms. **Copy link to this card** copies the full URL. Ignore unknown keys, and use `v` for migrations.
- **localStorage** (wrap every access in try/catch; the app must work without it):
  - `ncm.v1.style`: last-used style, applied to new cards
  - `ncm.v1.presets`: named presets ("Lecture deck"), with JSON import and export
  - `ncm.v1.settings`: privacy toggles: Internet Archive fallback (on), homepage feed discovery (on), Google favicon fallback (off)
- **IndexedDB** (v1.0): a `history` store holding the last 30 items `{ url, title, siteName, date, style, thumbnail: Blob(400px), createdAt }`, plus **Clear history**. Never store fetched HTML.

---

## 11. Bookmarklet

The bookmarklet works on **any page the user can see**, including bot-protected and paywalled pages. Only the page's preview metadata leaves the page, and only into the user's own tab.

- **Source:** `web/src/bookmarklet/collector.ts`. `scripts/build-bookmarklet.ts` bundles and minifies it into an IIFE (esbuild), injects `APP_URL`, and emits `web/src/bookmarklet/generated.ts` (gitignored, built before `vite build`), which exports the `javascript:` string for the install dialog.
- **Wrap the whole IIFE as `javascript:void(…)`.** Otherwise the expression's value (a Promise) can replace the current page in some browsers.
- **Collector:**
  1. Collect:
     - `html[lang]` and `title`
     - all `meta` tags
     - `link` tags whose `rel` matches `icon`, `apple-touch-icon(-precomposed)`, `mask-icon`, `manifest`, `canonical`, `alternate` (RSS/Atom/oEmbed), `image_src` or `amphtml`
     - every `script[type="application/ld+json"]` (each ≤ 200 KB)
     - the first 3 `h1` and first 5 `time[datetime]`
     - header logo candidates: at most 6 `img` (outerHTML) and at most 4 inline `svg` (each ≤ 60 KB, plus any referenced `<symbol>`)
  2. Build `<!doctype html><html lang><head><base href="{location.href}">…</head><body>…</body></html>`.
  3. Wrap it as JSON `{ v: 1, url: location.href, html }`, compress with `CompressionStream('deflate-raw')`, and encode as base64url.
  4. Set `location.href = APP_URL + '#bm=' + payload`. Navigating the same tab avoids popup blockers and COOP problems, and the fragment never reaches any server.
- **Receiver** (`receive.ts`):
  1. On boot, check for `#bm=`.
  2. Decode it and `DecompressionStream`. Cap the decoded size at 2 MB.
  3. Check that `url` is http(s).
  4. `history.replaceState` to drop the hash.
  5. Run the pipeline with provenance `bookmarklet` (images and manifest still go through the proxy).
- **Install dialog:** a link to drag to the bookmarks bar, plus a "copy code" button for browsers where dragging fails, plus a 3-step explanation.
- **Limitation:** strict page CSP can block bookmarklets in some browsers (notably Firefox). The fallback is **Paste page source**. Later, a small WebExtension (extra E9) can reuse the same collector.

```js
// Shape only. The real file is TypeScript, built and minified by scripts/build-bookmarklet.ts.
(async () => {
  const APP = '__APP_URL__';
  const grab = (sel, max = 50, cap = 200_000) =>
    [...document.querySelectorAll(sel)].slice(0, max).map(e => e.outerHTML).filter(h => h.length <= cap).join('');
  const head = grab('title', 1) + grab('meta', 400, 5_000)
    + grab('link[rel~="icon"],link[rel^="apple-touch-icon"],link[rel="mask-icon"],link[rel="manifest"],link[rel="canonical"],link[rel="alternate"],link[rel="image_src"],link[rel="amphtml"]', 60)
    + grab('script[type="application/ld+json"]', 20);
  const body = grab('h1', 3, 5_000) + grab('time[datetime]', 5, 2_000)
    + grab('header img,[role=banner] img,a[href="/"] img', 6, 20_000) + grab('header svg,[role=banner] svg,a[href="/"] svg', 4, 60_000);
  const lang = (document.documentElement.lang || '').replace(/"/g, '');
  const html = `<!doctype html><html lang="${lang}"><head><base href="${location.href.replace(/"/g, '%22')}">${head}</head><body>${body}</body></html>`;
  const stream = new Blob([JSON.stringify({ v: 1, url: location.href, html })]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  location.href = APP + '#bm=' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
})();
```

(Referenced `<symbol>` inlining is left out of this sketch. Implement it in the real collector.)

---

## 12. Security, privacy and ethics: hard rules

1. **Fetch only when the user explicitly asks.** One page plus its declared assets (manifest, icons, images), and fallback feeds or archive copies. No crawling, no prefetching links.
2. **No circumvention.** Use an honest UA. Never impersonate crawlers or browser fingerprints, never solve or skip challenges, never use headless browsers against bot protection, never spoof `Referer`, never get past paywalls. We only read the preview metadata publishers expose, or what the user's own browser hands over (bookmarklet, paste).
3. **Never fetch, store or render article body text.** Only headline-level metadata, the same thing a link preview shows.
4. **Safe rendering:**
   - Extracted strings only ever go in through `textContent`.
   - URL attributes must be `http(s)`, or `blob:`/`data:image` for images.
   - SVG is only ever displayed through `<img>`.
   - The parsed document is never attached to the live DOM.
5. **Proxy hardening** as in §4.3.
6. **App CSP**, set with `<meta http-equiv>` because GitHub Pages can't set headers: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: <PROXY_ORIGIN>; font-src 'self' data:; connect-src 'self' <PROXY_ORIGIN> https://hacker-news.firebaseio.com https://archive.org; object-src 'none'; base-uri 'none'; form-action 'none'`. If the capture library uses Web Workers, add `worker-src 'self' blob:`.
7. **Privacy:** no analytics, no URLs in proxy logs, and the README lists every third party with how to switch off the optional ones.
8. **Trademarks:** logos identify the source of a citation (nominative use). Add a README disclaimer. The registry references publisher-hosted logo URLs instead of bundling the files.

---

## 13. Testing

### 13.1 Unit tests (Vitest + jsdom, `web/tests/unit`)

Cover each of these:

- **Extractor:** every source, JSON-LD parsing (lenient parse, `@graph`, `@id` refs, main-entity choice), title cleanup and suffix stripping, entity decoding (double too), site-name normalisation, institutional authors, every date format and offset rule, image scoring and overlay penalties, URL cleaning, AMP and wrapper unwrapping, canonical rules.
- **Pages and feeds:** blocked-page classification, charset sniffing and decoding (ISO-8859-1 and Shift_JIS fixtures), feed parsing and matching (RSS 2.0, Atom, RDF, GUID-token matching).
- **Brand and render:** registry host matching (subdomains), theme contrast guarantees (property test over random brand colours: ink/bg ≥ 4.5), filename slugging, URL-state encode/decode round-trip.

### 13.2 Fixtures (`web/tests/fixtures/pages`)

- Write **synthetic, hand-made** HTML that reproduces each pattern in Appendix A, e.g. `guardian-like-overlay.html`, `spiegel-like-three-titles.html`, `corriere-like-latin1.html`, `yoast-graph-author-ref.html`, `hn-item.html`, `cloudflare-challenge.html`, `datadome.html`, `nature-like-cookie-redirect` (proxy test). Pair each with `*.expected.json`, snapshotting the `extract()` output.
- **Don't commit full third-party pages.** `scripts/capture-fixture.ts <url>` saves a head-only, body-stripped capture to `web/tests/fixtures/live/` (gitignored) for local debugging.
- The dev gallery and the visual snapshots use **synthetic models**, with placeholder images and logos generated locally (gradients, simple shapes). Keep no third-party images or logos in the repo.

### 13.3 Proxy tests (`@cloudflare/vitest-pool-workers`)

Mock all outbound fetches. Test the target guards (every range), origin allowlist, content-type allowlist and magic bytes, text truncation and `X-Truncated`, the image size cap, redirect chains with the cookie jar, the redirect limit, timeout mapping, the SVG CSP header, CORS headers on errors, and rate-limit responses.

### 13.4 End-to-end (Playwright: Chromium, WebKit, Firefox)

- Route `**/api/text*` and `**/api/image*` to fixtures.
- **Flows:** landing → URL → card, toggles, size changes, template switch, alternatives picker, image upload, blocked → paste source, bookmarklet hash receive, manual mode.
- **Clipboard (Chromium):** grant `clipboard-read` and `clipboard-write`, click Copy, read back with `navigator.clipboard.read()`, assert `image/png` and the expected pixel size.
- **Downloads:** check the file name and PNG dimensions.
- **Visual snapshots:** the *exported* PNG for each template × theme × {auto, 16:9}, with 0.5% tolerance. Run them on `dev/gallery.html`.
- Test the mobile viewport layout too.
- **Bookmarklet:** open a fixture article page, evaluate the built bookmarklet code, and assert that it navigates to the app with `#bm=` and that the card shows the fixture's headline.

### 13.5 Live smoke (`npm run smoke`, not a merge gate)

- Build the corpus at run time: the **newest item from each registry outlet's feed** (so it never goes stale) plus `scripts/smoke-urls.txt`.
- Call the deployed (or local) proxy and run the extractor in Node with jsdom. Send an allowlisted `Origin` header (§4.3).
- Write a Markdown report: for each outlet, whether title, site, image, date and logo were found, whether it was blocked, and which fallback was used. A weekly GitHub Action uploads it as an artifact.

### 13.6 Manual QA checklist (`docs/qa.md`)

Paste into Google Slides, PowerPoint (macOS and Windows) and Keynote. Test Safari, Firefox and Chrome on macOS, transparency on light and dark slides, and 4× export.

---

## 14. CI/CD and deployment

- **`ci.yml`** (PRs and pushes):
  1. setup-node from `.nvmrc`
  2. `npm ci`
  3. `npm run lint` (`biome check`) and `npm run check:html` (innerHTML guard)
  4. `npm run typecheck`
  5. `npm test` (web unit + proxy)
  6. `npm run build`
  7. `npx playwright install --with-deps` and `npm run e2e`
- **`deploy.yml`** (push to `main`):
  - **web:** build with `VITE_PROXY_URL=${{ vars.PROXY_URL }}` and `VITE_BASE=/news-card-maker/`, then `actions/upload-pages-artifact` → `actions/deploy-pages`.
  - **proxy** (only when `proxy/**` changed, or on manual dispatch): `cloudflare/wrangler-action` with secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- **`smoke.yml`:** weekly cron plus `workflow_dispatch`. Runs the smoke and registry checks and uploads the reports.
- **One-time setup for the owner** (document it in the README):
  1. Set Pages source to GitHub Actions.
  2. Create a free Cloudflare account and an API token with Workers edit permission.
  3. Add the secrets and the `PROXY_URL` variable.
  4. Set `ALLOWED_ORIGINS` to `https://<owner>.github.io`.
  5. Optional: a custom domain on Cloudflare, which enables edge caching.
- **Single-origin alternative** (document it, don't build it): one Worker with Static Assets serves `web/dist` and `/api/*` on the same origin. One deploy and no CORS, but it leaves GitHub Pages.

---

## 15. Milestones and acceptance criteria

General rule: every milestone ends with green lint, typecheck and tests, a successful build, a CHANGELOG line, a commit, and the checkbox here ticked. Sizes are relative effort: S, M or L.

### Phase 1 — MVP

- [x] **M0 Scaffold (S).** `git init`, then workspaces, Vite (vanilla TS), Biome, Vitest, Playwright, Wrangler, `.nvmrc`, `.gitignore` (`node_modules`, `dist`, `.wrangler`, `test-results`, `playwright-report`, `web/tests/fixtures/live`, `web/src/bookmarklet/generated.ts`), CI skeleton, MIT LICENSE, README stub, and `AGENTS.md` (commands, architecture summary, the §12 rules, conventions, definition of done) with `CLAUDE.md` containing `@AGENTS.md`. *Accept:* `npm run dev` serves a placeholder page that calls the proxy's `/health`; CI is green.
- [x] **M1 Proxy (M).** The full §4 contract, with tests (§13.3). *Accept:* tests green, and a manual `curl` through `wrangler dev` works for 5 cooperative outlets (text and image) and correctly rejects a private IP, a disallowed origin and a non-image.
- [x] **M2 Extraction core (L).** `charset`, `extract/*`, `rank`, `text`, `url`, `dates`, `blocked`, the HN adapter, and `net/pipeline` (direct path plus progressive events). Basic logo and colour candidates from page metadata only, with no analysis yet. *Accept:* all fixtures pass, and a local live run (`npm run smoke -- --local`) gets title, site, image and date right on at least 16 of the 19 cooperative outlets in Appendix A (HN through its adapter, which has no image).
- [x] **M3 Rendering (L).** The Classic, Split and Headline templates; Light, Dark, Brand, Paper and Mono themes; every size; fitting; fonts; the frame; RTL. Also `dev/gallery.html`. *Accept:* the gallery shows every combination with no overflow; RTL and CJK fixtures render correctly.
- [x] **M4 Editor UI (L).** Landing page, editor, schema panel, states (§9.5), shortcuts, `?url=` auto-load, the alternatives pickers, image upload/drop/paste, focal-point dragging. *Accept:* e2e flows pass on 3 engines; keyboard-only use works.
- [x] **M5 Export (M).** **Spike first:** compare `modern-screenshot` with `@zumer/snapdom` on the gallery in Chrome, Safari and Firefox for fidelity, speed and first-capture reliability, and record the result in `docs/decisions/0001-capture-library.md`. Then copy, download (PNG, JPEG, WebP), the fallback dialog, the scale guard, the pre-render cache and file names. *Accept:* Copy works in desktop Chrome, Firefox and Safari (checked manually and noted in `docs/qa.md`), the e2e clipboard test passes in Chromium, and the visual snapshots are stable.
- [x] **M6 Fallbacks I (M).** Paste source and drop `.html`, the bookmarklet (collector, build script, receiver, install dialog), manual mode with the registry outlet picker, the blocked-state UX, and the MVP registry seed (10 outlets, no logo analysis yet). *Accept:* the bookmarklet works on a live Economist article in Chrome and Safari, and the e2e test for the blocked fixture → paste flow passes.
- [x] **M7 Deploy and docs (S).** `deploy.yml`, CSP meta tag, README (what and why, screenshots generated by a Playwright script, usage, bookmarklet, privacy and third parties, self-hosting the proxy, development), one live smoke run. *Accept:* the public URL works end to end, and the smoke report is attached to the M7 commit or PR. *Status:* everything except the public URL is done. The URL needs the owner's Cloudflare token and Pages setting (README, "Deploying"); a Pages-shaped build under its base path and CSP is tested instead (`pages.spec.ts`), and the smoke report (`docs/smoke-2026-11-07.md`) comes from a local proxy.

### Phase 2 — v1.0

- [ ] **M8 Brand intelligence (L).** Header logo extraction with SVG serialisation, manifest fetching, logo validation, analysis and treatments (mono recolour), brand colour resolution, theme generation with contrast guarantees, the Image theme, accent swatches, `imageRewrites`, the full registry (~35) and `registry:check`. *Accept:* at least 80% of the smoke corpus has a usable logo, and contrast property tests pass.
- [ ] **M9 Fallbacks II (M).** Feed match (registry, page links, homepage discovery), Wayback, merging, provenance UI, privacy toggles. *Accept:* live Economist, NYT and FT URLs produce partial cards (headline, subtitle, date) with no bookmarklet, and fixture tests cover the RSS, Atom and GUID matching paths.
- [ ] **M10 Persistence and sharing (M).** URL state (`#s=`), last-used style, presets (with import and export), IndexedDB history with recents on the landing page. *Accept:* round-trip tests pass; reloading the page restores the exact card.
- [ ] **M11 Polish (M).** Accessibility audit (axe in e2e), performance budget, Lighthouse ≥ 95, final copywriting, empty states, cross-browser QA, i18n fixtures in e2e. *Accept:* every §1.4 criterion is met and documented.

### Phase 3 — Extras (in rough value/effort order)

- **E1** The Hero, Browser and Strip templates.
- **E2** QR code linking to the article (`uqr`, SVG, on a white rounded plate with a quiet zone, so it scans on any theme).
- **E3** Headline highlighting: `==text==` in the headline field renders a marker-style `<mark>` in the accent colour, plus a "Highlight selection" button.
- **E4** **Copy citation:** Plain, Markdown, APA 7, MLA 9, Chicago, and BibTeX `@online{…, urldate=}`. Also **Copy alt text** ("News headline from {Outlet}: “{Headline}” ({date})"), useful because slide tools support alt text.
- **E5** Image filters: greyscale, and a duotone in the brand colour (pre-baked on a canvas).
- **E6** **Batch mode:** paste many URLs, process 2 at a time with the same style, show a grid with per-card edits, and **Download all (ZIP)** with `fflate`.
- **E7** PWA: offline shell, and a Web Share Target in the manifest so Android users can share from a news app (parse the URL out of the shared `text`).
- **E8** **Compare mode:** 2–3 cards side by side in one image, e.g. how different outlets framed the same story.
- **E9** WebExtension: a "Make news card" context-menu item that reuses the bookmarklet collector and has no CSP limits.
- **E10** More adapters (YouTube via oEmbed, arXiv, Wikipedia REST summary, Reddit), and a generic oEmbed source.

---

## 16. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Datacenter IPs get blocked more often than the residential IP used for the probe | More partial cards | Registry `fetch: "blocked"` triggers fallbacks in parallel; feeds, Wayback, bookmarklet, paste; the smoke report tracks it weekly |
| DOM-to-image quirks, especially in Safari | Broken or blank exports | Spike in M5, adapter, warm-up capture, no risky CSS, WebKit e2e and visual snapshots, Download fallback |
| Inconsistent logo quality | Ugly mastheads | Registry for top outlets, header-SVG extraction, validation and analysis, candidate picker, upload your own, monogram |
| Proxy abuse | Free-tier exhaustion | Origin allowlist, rate limits, type and size caps, no HTML rendering, no cookies; capacity of about 10k cards/day |
| Clipboard API differences | Copy fails | Synchronous `ClipboardItem` with a Promise, feature detection, a fallback dialog with Download |
| Missing glyphs (CJK, Arabic) | Tofu in exports | System fallback stacks, i18n fixtures |
| Headline drift (live blogs, edited headlines) | Card differs from what the user saw | Alternatives menu; the user can edit; the bookmarklet takes the page exactly as the user sees it |
| Legal: trademarks and copyright | Takedown requests | Metadata only, nominative logo use, no bundled logos, README disclaimer, no body text |
| Free-tier changes | Outage | Web-standard proxy code; Appendix C port; single-origin option |

**Known limitations to document:** some sites block everything or need JS rendering; EU users may hit consent walls or US local sites geo-blocked with 451 (the Worker runs near the user); Google News links that use JS redirects; X, Instagram and LinkedIn aren't supported.

---

## 17. Owner decisions (defaults in bold; proceed with them unless told otherwise)

1. **Proxy platform:** **Cloudflare Workers** (needs a free account and an API token for CI). Alternative: the FastAPI or HF Space port in Appendix C.
2. **Public URL:** **`https://<owner>.github.io/news-card-maker/`**, or a custom domain (on Cloudflare, that also gives the proxy edge caching).
3. **Product name:** **"News Card Maker"** (placeholder).
4. **Analytics:** **none**.
5. **Optional third parties:** **Internet Archive on**, **homepage feed discovery on**, **Google favicon fallback off**.
6. **Licence:** **MIT**.

---

## Appendix A — Field notes from probing 25 outlets (2026-11-07)

**Method:** one recent article per outlet, picked from its RSS feed (Il Post's from its homepage, because its feed refused our UA), fetched from a residential European IP with the honest UA from §4.2 and with a desktop Chrome UA. **Both UAs got identical results on every outlet.**

- **Blocked (6 of 25):**

  | Outlet | Response |
  |---|---|
  | The Economist | Cloudflare challenge "Just a moment...", 403 |
  | Financial Times | Cloudflare "Security Verification", 403 |
  | New York Times | DataDome 403, `<title>` "nytimes.com" |
  | Wall Street Journal | DataDome 401, "wsj.com" |
  | Le Monde | 402 "Accès restreint" |
  | Washington Post | connection reset at the HTTP/2 layer |

  Expect at least as many from a datacenter IP.
- **Feeds and static assets of blocked outlets** (favicons, `apple-touch-icon`, image CDNs such as `static01.nyt.com`) all loaded fine. Feed items carried title, description and date, and images for NYT (1800 px), Le Monde and FT. Wayback had snapshots for the FT, Le Monde and WSJ articles, but none for the Economist and NYT articles (both under a day old).
- **Cooperative (19):** 404 Media, Al Jazeera, ANSA, Ars Technica, BBC, Bloomberg, Corriere della Sera, El País, The Guardian, Hacker News, Il Post, ITmedia, Nature, la Repubblica, Il Sole 24 ORE, DER SPIEGEL, TechCrunch, The Verge, Wired. All except HN have `og:title`.
- **Title disagreements:** Spiegel's `og:title`, `ld.headline` and `h1` were all different. Wired's `og:title` is a social headline unlike its `ld`/`h1` headline. ANSA's `og:title` ends "- Ultima ora - Ansa.it". Corriere's ends "| <column author>". TechCrunch's ends "| TechCrunch". ITmedia's `h1` is empty.
- **JSON-LD:** Corriere's `headline` is entity-encoded. TechCrunch (Yoast) authors are `@id` references in `@graph`. Il Post's `ld` and meta offsets disagree (same day). ANSA and Il Sole 24 ORE use `+0100`. Sailthru and Spiegel `<time>` use `YYYY-MM-DD HH:MM:SS` with no zone. Bloomberg, El País, Repubblica and The Verge have `isAccessibleForFree: false`.
- **Charset and language:** the Corriere article is ISO-8859-1. The (Italian) Repubblica article declares `lang="en"`. ITmedia is UTF-8.
- **Images:** The Guardian's OG and Twitter images have a burned-in logo (`overlay-*`, signed); its JSON-LD has clean variants. BBC's OG image path is `/ace/branded_news/`, and `/ace/standard/` variants exist on the same CDN. About half of outlets don't declare `og:image:width` or `og:image:height`.
- **Publisher logos (`ld`):** good wordmarks from Ars (186×60), Guardian (190×60), Bloomberg (262×60, plus an SVG on the `Organization`), Il Sole 24 ORE (359×112) and Spiegel (60 px tall). Junk from BBC (a poster), El País (a newsletter image), The Verge (a placeholder) and Wired (a newsletter JPG).
- **Header logos:** clean SVG wordmarks in `<header>` on El País, TechCrunch, Wired and ITmedia. Repubblica has one just outside `<header>`. Inline SVGs with `aria-label` on Bloomberg, BBC and Al Jazeera. Distractors elsewhere on the page: coupon partner logos (Wired), sub-brand logos (Nature), social icons (Corriere).
- **Colours:** meta `theme-color` is often neutral (404 Media `#000000`, BBC `#FFFFFF`, Nature `#000000`), while the brand lives elsewhere: 404 Media's manifest `#E50B4F`, BBC's `msapplication-TileColor` `#BB1919`. Spiegel declares light and dark `theme-color` with `media`. The Guardian's `#052962` appears in both meta and manifest. Il Sole 24 ORE: paper `#F5E5D5`, `mask-icon` `#003C7F`.
- **Site names:** `og:site_name` "the Guardian" (lowercase "the") and "Bloomberg.com". El País's `ld.publisher` is "Ediciones EL PAÍS S.L.". Spiegel has no `og:site_name`. Nature uses `application-name`. ANSA uses "Agenzia ANSA".
- **Authors:** institutional values ("Al Jazeera Staff", "Agenzia ANSA", "DER SPIEGEL"), and `article:author` holding URLs (Guardian profile page, BBC Facebook page).
- **Tracking parameters in feed links:** `at_medium` and `at_campaign` (BBC), `traffic_source` (Al Jazeera), `syn-<hash>` (FT), `#ref=rss` (Spiegel).
- **Redirects:** nature.com redirects 3 times to set cookies. Without a cookie jar you land on `?error=cookies_not_supported`.
- **Sizes:** HTML is up to 1.9 MB (Wired), and `<head>` up to 850 KB (Il Sole 24 ORE).
- **CORS:** the HN Firebase API, the Algolia HN API and the archive.org availability API send CORS headers. `news.ycombinator.com/y18.svg`, Google's favicon redirect and DuckDuckGo's icon service don't, so they go through the proxy.

## Appendix B — Reference lists

- **B.1 Tracking parameters to strip:**
  - by prefix: `utm_*`, `at_*`, `syn-*`
  - `mc_cid`, `mc_eid`, `fbclid`, `gclid`, `dclid`, `gbraid`, `wbraid`, `msclkid`, `yclid`, `twclid`, `ttclid`, `igshid`, `li_fat_id`
  - `_hsenc`, `_hsmi`, `mkt_tok`, `oly_anon_id`, `oly_enc_id`, `vero_id`, `rb_clickid`, `s_cid`, `cmpid`, `CMP`, `ocid`, `xtor`
  - `smid`, `smtyp` (NYT share), `sr_share`, `traffic_source`, `ref`, `ref_src`, `ref_url`, `share`, `shared`, `guccounter`, `guce_referrer`, `guce_referrer_sig`
  - gift-link tokens: `unlocked_article_code`, `giftCopy`, `gift`
  - `_ga`, `_gl`, `spm`

  Always drop fragments. The canonical URL takes precedence anyway.
- **B.2 Published-date keys (lowercased):** `article:published_time`, `datepublished`, `publisheddate`, `publishdate`, `publish-date`, `publish_date`, `pubdate`, `date`, `dc.date`, `dc.date.issued`, `dc.date.created`, `dcterms.created`, `dcterms.issued`, `citation_publication_date`, `citation_date`, `citation_online_date`, `parsely-pub-date`, `sailthru.date`, `article.published`, `original-publish-date`. **Modified:** `article:modified_time`, `og:updated_time`, `datemodified`, `dcterms.modified`.
- **B.3 Challenge `<title>` patterns:**
  - `/^just a moment/i`, `/^attention required/i`, `/security verification/i`, `/access denied/i`, `/accès restreint/i`
  - `/are you a (robot|human)/i`, `/pardon our interruption/i`, `/verify you are (a )?human/i`
  - a bare hostname: `/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/i`

  Body markers are listed in §5.7.
- **B.4 Legal-entity suffixes (down-rank):** S.A., S.L., S.p.A., S.r.l., Ltd, Limited, LLC, L.L.C., Inc., Corp., Corporation, GmbH, AG, SE, B.V., N.V., PLC, Pty, Co., plus trailing "Group", "Media Group" and "Publishing".
- **B.5 Junk section values:** tags, news, home, article, articles, story, stories, content, general, default, uncategorized, and the empty string or a single character.
- **B.6 RTL language subtags:** ar, arc, ckb, dv, fa, he, iw, ps, sd, ug, ur, yi.

## Appendix C — Optional FastAPI port (HF Space) of the proxy

Use this only if the owner prefers not to use Cloudflare.

- **File:** `server/app.py` (~150 lines), FastAPI plus `httpx.AsyncClient(follow_redirects=False, timeout=8)`. It implements **the same §4 contract**, so the web app only changes `VITE_PROXY_URL`.
- **SSRF protection** (critical here):
  - Resolve the host with `getaddrinfo`, and reject it unless **every** resolved address is `ipaddress.ip_address(a).is_global`.
  - Pin the connection to the vetted IP, or check the peer address after connecting via `response.extensions["network_stream"].get_extra_info("server_addr")`, to defeat DNS rebinding.
  - Re-validate every redirect hop.
- **Behaviour:**
  - Manual redirect loop with an `httpx.Cookies` jar.
  - Stream with `aiter_bytes()` and enforce the byte caps.
  - Magic-byte sniffing as in §4.1.
  - CORS middleware with the allowlist.
  - A simple in-memory per-IP token bucket.
- **Single-origin hosting:** mount `web/dist` with `StaticFiles(html=True)` at `/`, so one Space serves everything and `VITE_PROXY_URL` is the same origin.
- **HF Space settings:** Docker SDK, `app_port: 7860`. Free CPU Spaces sleep after a period of inactivity, so the first visit afterwards has a cold start of tens of seconds. That's acceptable for occasional use, but a worse experience than Workers.
