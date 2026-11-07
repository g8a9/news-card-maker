# 0002: Use `@cloudflare/vitest-plugin` instead of `@cloudflare/vitest-pool-workers`

- **Status:** accepted, 2026-11-07
- **Plan reference:** §3.4 (dependencies), §13.3 (proxy tests), D9 (tooling)

## Context

PLAN.md names `@cloudflare/vitest-pool-workers` for the proxy tests. On 2026-11-07 npm marks that package
as deprecated ("renamed to `@cloudflare/vitest-plugin`; will not receive future updates"). Its last
release (0.23.0) also peers on `vitest ^4.1.0`, so it would have forced a second Vitest major into the
workspace, and `npm audit` reported 6 vulnerabilities through its pinned `miniflare` / `wrangler`.

## Decision

Use `@cloudflare/vitest-plugin@^1.6.0`. It supports Vitest 4.1 and 5, so every workspace stays on
Vitest 5. Tests run in the real Workers runtime (workerd via Miniflare), exactly as the plan intends.
The Vite plugin is `cloudflareTest()`, and tests import `exports` / `env` from `cloudflare:workers`.

## Consequences

- `npm audit` is clean after the switch.
- Same capabilities as the plan: unit and integration tests inside workerd, bindings from `wrangler.jsonc`.
- If Cloudflare renames the package again, only `proxy/vitest.config.ts` and `proxy/package.json` change.
