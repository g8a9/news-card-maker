// The app's Content-Security-Policy (PLAN.md §12.6). GitHub Pages cannot send response headers, so the
// policy is a <meta> tag that vite.config.ts injects into index.html at build time.
//
// Keep this list in step with the network endpoints the app really uses (AGENTS.md rule 6) and with the
// third parties named in the README. The Internet Archive (Phase 2, M9) is added when that fallback lands.

export interface CspOptions {
  /** Base URL of the fetch proxy; its origin is allowed for requests and images. */
  proxyUrl?: string;
}

const originOf = (url: string | undefined): string | null => {
  if (!url) return null;
  try {
    const { origin } = new URL(url);
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
};

export function buildCsp({ proxyUrl }: CspOptions = {}): string {
  const proxy = originOf(proxyUrl);
  const list = (...sources: string[]) => [...sources, ...(proxy ? [proxy] : [])].join(' ');
  return [
    "default-src 'self'",
    "script-src 'self'",
    // Inline styles: the card is positioned and themed with style attributes and custom properties.
    "style-src 'self' 'unsafe-inline'",
    // Pictures are shown from blob: URLs (fetched through the proxy) and data: URLs (exported cards).
    `img-src ${list("'self'", 'blob:', 'data:')}`,
    "font-src 'self' data:",
    // blob: and data: because the exporter reads the card's images back to inline them.
    `connect-src ${list("'self'", 'blob:', 'data:', 'https://hacker-news.firebaseio.com')}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}
