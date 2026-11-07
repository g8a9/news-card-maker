# Changelog

All notable changes to this project are listed here, newest first.

## Unreleased

- M1: Cloudflare Worker proxy with the §4 contract: `/api/text`, `/api/image`, `/health`, target guards on every redirect hop, origin allowlist, rate-limit bindings, per-request cookie jar, size and type caps, edge cache, and 180 tests running in workerd.
- M0: scaffold (npm workspaces `web` and `proxy`, Vite + TypeScript, Biome, Vitest, Playwright, Wrangler, CI skeleton, AGENTS.md).
