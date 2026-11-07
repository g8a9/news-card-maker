# 0006: Deployment workflows and the content security policy

- **Status:** accepted, 2026-11-07
- **Plan reference:** §12.6 (CSP), §14 (CI/CD and deployment), M7

M7 follows the plan. These are the choices it leaves open, and the two places where the result differs
from the text.

## Changes

1. **The CSP differs from §12.6 in two ways.** `connect-src` also allows `blob:` and `data:`: the exporter
   reads the card's images back (they are `blob:` object URLs) and Chromium, Firefox and WebKit all report
   a violation without them (`tests/e2e/csp.spec.ts` fails when they are removed). `https://archive.org`
   is left out, because the Internet Archive fallback is Phase 2 (M9) and the policy must list only the
   endpoints in use (AGENTS.md rule 6). No `worker-src` is needed: the exporter does not use Web Workers.
   The policy is built in `web/csp.ts` and injected into `index.html` only (not into the dev gallery) at
   build time, with the proxy's origin taken from `VITE_PROXY_URL`. A test runs the downloads, copy, the
   dialogs and a template switch under it and fails on any `securitypolicyviolation`; another proves the
   policy bites (an inline script and a request to another host are refused).

2. **`deploy.yml` checks before it publishes.** §14 lists a build and two jobs. The site job also runs lint,
   `check:html`, typecheck and the unit tests first (a minute or two), so a broken `main` is never
   published; the end-to-end suite stays in `ci.yml`. A missing `PROXY_URL` variable stops the site job
   with a message that names the fix, instead of publishing a site that cannot reach its proxy.

3. **Deploy settings come from repository variables, with defaults.** `PROXY_URL` is required.
   `BASE_PATH` (default `/<repository>/`) and `ALLOWED_ORIGINS` (default `https://<owner>.github.io`,
   lowercased) are for a custom domain. The proxy's `USER_AGENT` is set from the repository address at
   deploy time, which replaces the `OWNER` placeholder in `wrangler.jsonc`.

4. **Whether the proxy changed is a `git diff`, not an action.** A path-filter action would add a third
   party to a workflow that holds the Cloudflare token; the shell step compares the pushed range with
   `proxy/`, and deploys when it cannot compare (a first push) or when asked by hand.

5. **The footer's repository link is a build setting.** The landing page's GitHub icon appeared with a
   placeholder address. It now shows only when `VITE_REPO_URL` is set, which `deploy.yml` does from the
   repository the workflow runs in.

6. **The weekly smoke run keeps the full report as an artifact; the committed one is redacted.**
   `npm run smoke -- --redact` writes found / missing instead of headlines and leaves out the article
   addresses, so `docs/smoke-2026-11-07.md` contains no third-party headline text. The smoke script now
   waits three seconds between page requests (20 a minute): at 2.2 seconds the proxy's limiter, which is
   approximate, tripped on a corpus of twenty outlets that each need a feed request and an article request.
