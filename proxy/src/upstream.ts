// Upstream fetching (PLAN.md §4.2): honest User-Agent, manual redirects with the target guards
// re-run on every hop, a per-request cookie jar, and a single timeout for the whole chain.
import { ProxyError } from './errors.ts';
import { assertTargetAllowed } from './guards.ts';

export const MAX_REDIRECTS = 6;
export const TIMEOUT_MS = { text: 8000, image: 10000 } as const;

export const ACCEPT = {
  text: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml;q=0.9,application/atom+xml;q=0.9,application/json;q=0.8,*/*;q=0.5',
  image:
    'image/avif,image/webp,image/svg+xml,image/png,image/jpeg,image/gif,image/x-icon,image/*;q=0.8',
} as const;

export type Kind = keyof typeof ACCEPT;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_COOKIES = 50;
const MAX_COOKIE_HEADER = 4096;

interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  path: string;
  secure: boolean;
  expiresAt: number | null;
}

const domainMatch = (host: string, domain: string): boolean =>
  host === domain || host.endsWith(`.${domain}`);

const pathMatch = (requestPath: string, cookiePath: string): boolean =>
  requestPath === cookiePath ||
  (requestPath.startsWith(cookiePath) &&
    (cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/'));

const defaultPath = (pathname: string): string => {
  const i = pathname.lastIndexOf('/');
  return i <= 0 ? '/' : pathname.slice(0, i);
};

/** A deliberately small cookie jar: it lives for one proxied request and is never persisted. */
export class CookieJar {
  private cookies: StoredCookie[] = [];

  get size(): number {
    return this.cookies.length;
  }

  /** Stores every Set-Cookie of a response that came from `url`. */
  store(headers: Headers, url: URL, now = Date.now()): void {
    for (const line of headers.getSetCookie()) this.add(line, url, now);
  }

  add(line: string, url: URL, now = Date.now()): void {
    const [pair = '', ...attributes] = line.split(';');
    const eq = pair.indexOf('=');
    if (eq <= 0) return;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    let domain = url.hostname;
    let hostOnly = true;
    let path = defaultPath(url.pathname);
    let secure = false;
    let expiresAt: number | null = null;
    let maxAge: number | null = null;

    for (const attribute of attributes) {
      const i = attribute.indexOf('=');
      const key = (i < 0 ? attribute : attribute.slice(0, i)).trim().toLowerCase();
      const val = i < 0 ? '' : attribute.slice(i + 1).trim();
      if (key === 'domain') {
        const d = val.replace(/^\./, '').toLowerCase();
        // Browsers refuse cookies for foreign or bare-suffix domains; so do we.
        if (!d.includes('.') || !domainMatch(url.hostname, d)) return;
        domain = d;
        hostOnly = false;
      } else if (key === 'path') {
        if (val.startsWith('/')) path = val;
      } else if (key === 'secure') {
        secure = true;
      } else if (key === 'max-age') {
        const n = Number.parseInt(val, 10);
        if (!Number.isNaN(n)) maxAge = n;
      } else if (key === 'expires') {
        const t = Date.parse(val);
        if (!Number.isNaN(t)) expiresAt = t;
      }
    }
    if (maxAge !== null) expiresAt = now + maxAge * 1000;

    this.cookies = this.cookies.filter(
      (c) => !(c.name === name && c.domain === domain && c.path === path),
    );
    if (expiresAt !== null && expiresAt <= now) return; // an expired cookie is a deletion
    if (this.cookies.length >= MAX_COOKIES) return;
    this.cookies.push({ name, value, domain, hostOnly, path, secure, expiresAt });
  }

  /** The `Cookie` header for a request to `url`, or null when no cookie applies. */
  header(url: URL, now = Date.now()): string | null {
    const matching = this.cookies
      .filter(
        (c) =>
          (c.hostOnly ? url.hostname === c.domain : domainMatch(url.hostname, c.domain)) &&
          pathMatch(url.pathname, c.path) &&
          (!c.secure || url.protocol === 'https:') &&
          (c.expiresAt === null || c.expiresAt > now),
      )
      .sort((a, b) => b.path.length - a.path.length);
    if (matching.length === 0) return null;
    const header = matching.map((c) => `${c.name}=${c.value}`).join('; ');
    return header.length <= MAX_COOKIE_HEADER ? header : null;
  }
}

export interface UpstreamResult {
  response: Response;
  finalUrl: URL;
  redirectCount: number;
}

/** `Accept-Language` is forwarded so localised outlets answer in the user's language. */
export function sanitiseLanguage(value: string | null): string | null {
  if (!value) return null;
  const clean = value.slice(0, 100).replace(/[^A-Za-z0-9,;=.\-* ]/g, '');
  return clean.trim() === '' ? null : clean.trim();
}

export function mapFetchError(e: unknown): ProxyError {
  if (e instanceof ProxyError) return e;
  const name = (e as { name?: string } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new ProxyError('UPSTREAM_TIMEOUT', 'The site took too long to respond');
  }
  return new ProxyError('UPSTREAM_UNREACHABLE', 'Could not reach the site');
}

export async function fetchUpstream(
  target: URL,
  kind: Kind,
  acceptLanguage: string | null,
  env: { USER_AGENT: string },
  selfHostname: string,
): Promise<UpstreamResult> {
  const signal = AbortSignal.timeout(TIMEOUT_MS[kind]);
  const jar = new CookieJar();
  const language = sanitiseLanguage(acceptLanguage);
  let current = target;

  for (let hop = 0; ; hop++) {
    // Never a Referer, never client cookies, never another crawler's or browser's identity.
    const headers = new Headers({ 'User-Agent': env.USER_AGENT, Accept: ACCEPT[kind] });
    if (language) headers.set('Accept-Language', language);
    const cookie = jar.header(current);
    if (cookie) headers.set('Cookie', cookie);

    let response: Response;
    try {
      response = await fetch(current.href, { method: 'GET', headers, redirect: 'manual', signal });
    } catch (e) {
      throw mapFetchError(e);
    }
    jar.store(response.headers, current);

    const location = response.headers.get('Location');
    if (!REDIRECT_STATUSES.has(response.status) || !location) {
      return { response, finalUrl: current, redirectCount: hop };
    }

    await response.body?.cancel().catch(() => {});
    if (hop >= MAX_REDIRECTS) {
      throw new ProxyError('TOO_MANY_REDIRECTS', 'The site redirected too many times');
    }
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new ProxyError('UPSTREAM_UNREACHABLE', 'The site sent an invalid redirect');
    }
    next.hash = '';
    assertTargetAllowed(next, selfHostname); // every hop is checked, not just the first URL
    current = next;
  }
}
