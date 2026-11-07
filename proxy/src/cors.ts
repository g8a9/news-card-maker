// Origin allowlist and CORS headers (PLAN.md §4.1, §4.3).

/** Every `X-*` header the text endpoint sets; the browser may read all of them. */
export const EXPOSED_HEADERS = [
  'X-Upstream-Status',
  'X-Upstream-Content-Type',
  'X-Final-Url',
  'X-Redirect-Count',
  'X-Truncated',
  'X-Fetch-Ms',
];

interface OriginEnv {
  ALLOWED_ORIGINS: string;
}

const normalise = (origin: string): string => origin.trim().replace(/\/+$/, '').toLowerCase();

export function allowedOrigins(env: OriginEnv): Set<string> {
  return new Set(
    (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map(normalise)
      .filter((o) => o.length > 0 && o !== '*'), // a wildcard would defeat the allowlist
  );
}

export function isAllowedOrigin(origin: string | null, env: OriginEnv): boolean {
  if (!origin) return false;
  return allowedOrigins(env).has(normalise(origin));
}

/** Adds CORS headers in place. Without an allowed origin only `Vary: Origin` is set. */
export function applyCors(headers: Headers, origin: string | null, env: OriginEnv): void {
  headers.append('Vary', 'Origin');
  if (!isAllowedOrigin(origin, env) || !origin) return;
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Expose-Headers', EXPOSED_HEADERS.join(', '));
}

export function withCors(res: Response, origin: string | null, env: OriginEnv): Response {
  const headers = new Headers(res.headers);
  applyCors(headers, origin, env);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export function preflight(origin: string | null, env: OriginEnv): Response {
  const headers = new Headers();
  applyCors(headers, origin, env);
  if (isAllowedOrigin(origin, env)) {
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Accept, Accept-Language');
    headers.set('Access-Control-Max-Age', '86400');
  }
  return new Response(null, { status: 204, headers });
}
