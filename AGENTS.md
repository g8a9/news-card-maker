# AGENTS.md

Guidance for AI coding agents (and humans) working on **News Card Maker**: a carbon.now.sh-style tool
that turns a news link into a clean, citable card (headline, subtitle, image, outlet logo, date, URL) and
copies it to the clipboard as a PNG. `PLAN.md` is the full design; this file is the working summary.

## Commands

| Command                           | What it does                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------ |
| `npm install`                     | Install all workspaces (Node 24+; `.nvmrc` pins the version CI uses)           |
| `npm run dev`                     | Proxy (`wrangler dev`, :8787) and web app (Vite, :5173) together               |
| `npm run dev -w web` / `-w proxy` | Run one side only                                                              |
| `npm run lint` / `npm run format` | Biome check / check with fixes                                                 |
| `npm run check:html`              | Fails if `innerHTML`-style APIs appear in `web/src`                            |
| `npm run typecheck`               | `tsc --noEmit` for web, proxy and scripts                                      |
| `npm test`                        | Vitest: web unit tests (jsdom) and proxy tests (Workers runtime)               |
| `npm run build`                   | Production build of the web app (`web/dist`)                                   |
| `npm run e2e`                     | Playwright (Chromium, Firefox, WebKit) against a built, preview-served app     |
| `npm run smoke`                   | Live smoke run against real outlets (not a merge gate; needs a running proxy)  |
| `npm run registry:check`          | Registry shape; with `-- --local` also loads every logo and feed via the proxy |
| `npm run inspect -- <url>`        | What extraction finds on one page (through a local proxy)                      |
| `npm run screenshots`             | Regenerates `docs/screenshots` for the README from synthetic data              |

Run lint, check:html, typecheck, test, build and e2e before calling anything done.

## Architecture in one screen

- `web/` is a static site: Vite + vanilla TypeScript, no UI framework. It is deployed to GitHub Pages.
- `proxy/` is a tiny Cloudflare Worker. Browsers cannot read cross-origin pages, so the Worker fetches
  pages (`/api/text`) and images (`/api/image`) for them. It never parses anything.
- All extraction runs **in the browser**. `web/src/core/extract` is a pure function,
  `extract(document, { pageUrl, inputUrl })`, shared by the proxy path, the bookmarklet and paste.
- `web/src/core` is pure: no network, no globals except a `Document` passed in. `web/src/net` does the
  fetching (proxy, adapters, pipeline). `brand/` holds logos, colours and themes. `render/` builds the
  card DOM. `export/` turns it into a PNG. `ui/` is the editor. `state/` is the store.
- `web/src/bookmarklet/generated.ts` is built by `scripts/build-bookmarklet.ts` (npm `pre*` hooks run it before
  dev, build, test, typecheck and preview). It is gitignored. Never edit it, and never commit it.
- The card is HTML/CSS sized in a `--u` unit (width / 100), exported with a DOM-to-image library behind
  `export/capture.ts` (see `docs/decisions/0001-capture-library.md`).

## Hard rules (PLAN.md §12)

1. Fetch only when the user explicitly asks. One page plus its declared assets. No crawling or prefetching.
2. **No circumvention.** Honest User-Agent. Never impersonate crawlers or browsers, never solve or skip
   challenges, never use headless browsers against bot protection, never spoof `Referer`, never get
   past paywalls. Blocked sites fall back to feeds, archives, the bookmarklet, pasted source, or manual entry.
3. Never fetch, store or render article body text. Headline-level metadata only.
4. Safe rendering: extracted strings only ever go in through `textContent`; URL attributes must be
   `http(s)` (or `blob:` / `data:image` for images); SVG is only shown through `<img>`; parsed documents
   are never attached to the live DOM. `npm run check:html` enforces the no-`innerHTML` part.
5. Proxy hardening (PLAN.md §4.3): origin allowlist, target guards, rate limits, size and type caps, no cookies, no URLs in logs.
6. The app CSP is a `<meta>` tag (GitHub Pages cannot set headers), built by `web/csp.ts` and injected into the
   built `index.html` by `vite.config.ts`. Keep it in sync with the network endpoints in use; `csp.spec.ts`
   runs every feature under it and fails on any violation.
7. Privacy: no analytics, and the README lists every third party and how to switch off the optional ones.
8. Logos identify the source of a citation. Reference publisher-hosted logo URLs; do not bundle third-party logo files or article images in the repo. Fixtures and gallery models use synthetic data.

## Conventions

- TypeScript, strict, **erasable syntax only** (no enums, namespaces or parameter properties) and
  **relative imports with `.ts` extensions**, so Node can run `core/`, `net/` and `brand/` code directly from
  `scripts/` (smoke runs, fixture capture). Keep `import.meta.env` out of those folders.
- Biome formats and lints (single quotes, semicolons, 100 columns). Do not hand-format.
- No default exports except where a tool requires them (Worker entry, config files).
- Build DOM with `h()` from `render/h.ts`. Never concatenate markup strings.
- Colours and sizes in cards come from CSS variables on the card root (`--bg --ink --muted --rule --accent`,
  `--u`). No `backdrop-filter`, CSS `filter`, `mask-image` or blend modes inside cards: they export badly.
- Tests live next to their workspace: `web/tests/{unit,e2e,fixtures}`, `proxy/test`. Fixtures are
  synthetic, hand-made pages; never commit full third-party pages, images or logos.
- Any deviation from `PLAN.md` gets a short ADR in `docs/decisions/NNNN-title.md` and a note in `PLAN.md`.
- Tick the milestone checkbox in `PLAN.md` §15 and add a `CHANGELOG.md` line when a milestone lands.

## Definition of done

Lint, `check:html`, typecheck, unit tests, build and e2e are green; acceptance criteria in `PLAN.md` §15 for
the milestone are met (or the gap is written down); docs and `CHANGELOG.md` are updated; one commit per
milestone. Say plainly what was not verified (for example real Safari clipboard behaviour, or live sites).

## Things that need the owner

Cloudflare login or API token, GitHub Pages settings, the `PROXY_URL` repository variable, creating the remote
repository, and pushing. The workflows and the README's "Deploying" section are written; do not attempt these.
`wrangler dev` works locally without an account.
