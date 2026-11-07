// News Card Maker fetch proxy (PLAN.md §4). Fetches pages and images for the browser, which cannot
// read cross-origin pages. It never parses bodies and never keeps URLs in its logs.
// Only web-standard APIs are used, so it can move to another edge runtime with little glue.
import { cacheLookup, cacheStore } from './cache.ts';
import { applyCors, isAllowedOrigin, preflight, withCors } from './cors.ts';
import { errorBody, ProxyError } from './errors.ts';
import { parseTarget } from './guards.ts';
import {
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_TEXT_BYTES,
  imageResponse,
  positiveInt,
  textResponse,
} from './responses.ts';
import { fetchUpstream, type Kind } from './upstream.ts';

export interface Env {
  ALLOWED_ORIGINS: string;
  USER_AGENT: string;
  MAX_TEXT_BYTES?: string;
  MAX_IMAGE_BYTES?: string;
  /** Set by the deploy workflow (git sha). */
  VERSION?: string;
  RL_TEXT: RateLimit;
  RL_IMAGE: RateLimit;
}

function failFrom(e: unknown, origin: string | null, env: Env, kind?: Kind): Response {
  const err =
    e instanceof ProxyError
      ? e
      : new ProxyError('INTERNAL_ERROR', 'Something went wrong in the proxy');
  // Logs carry error codes only, never the page that was being fetched.
  if (err.status >= 500)
    console.log(JSON.stringify({ event: 'proxy_error', code: err.code, kind }));

  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...err.headers,
  });
  applyCors(headers, origin, env);
  return new Response(errorBody(err.code, err.message), { status: err.status, headers });
}

function health(origin: string | null, env: Env): Response {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  applyCors(headers, origin, env);
  return new Response(JSON.stringify({ ok: true, version: env.VERSION ?? 'dev' }), { headers });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin');

    if (req.method === 'OPTIONS') return preflight(origin, env);
    if (url.pathname === '/health') return health(origin, env);

    const kind: Kind | null =
      url.pathname === '/api/text' ? 'text' : url.pathname === '/api/image' ? 'image' : null;
    if (!kind) return failFrom(new ProxyError('NOT_FOUND', 'Not found'), origin, env);
    if (req.method !== 'GET') {
      return failFrom(new ProxyError('METHOD_NOT_ALLOWED', 'Only GET is supported'), origin, env);
    }
    if (!isAllowedOrigin(origin, env)) {
      // No CORS headers: a disallowed page must not be able to read even this error.
      return failFrom(new ProxyError('ORIGIN_NOT_ALLOWED', 'Origin is not allowed'), null, env);
    }

    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
    const limiter = kind === 'text' ? env.RL_TEXT : env.RL_IMAGE;
    const { success } = await limiter.limit({ key: ip });
    if (!success) {
      return failFrom(
        new ProxyError('RATE_LIMITED', 'Too many requests, try again in a minute', {
          'Retry-After': '60',
        }),
        origin,
        env,
        kind,
      );
    }

    const startedAt = Date.now();
    try {
      const target = parseTarget(url.searchParams.get('url'), url.hostname);
      const language = req.headers.get('Accept-Language');

      const cached = await cacheLookup(kind, target, language);
      if (cached) return withCors(cached, origin, env);

      const upstream = await fetchUpstream(target, kind, language, env, url.hostname);
      const res =
        kind === 'text'
          ? await textResponse(
              upstream,
              positiveInt(env.MAX_TEXT_BYTES, DEFAULT_MAX_TEXT_BYTES),
              startedAt,
            )
          : await imageResponse(
              upstream,
              positiveInt(env.MAX_IMAGE_BYTES, DEFAULT_MAX_IMAGE_BYTES),
            );
      // Streamed images of unknown size are not cached: if one outgrows the cap its stream errors
      // midway, and a half-written entry is no use to anyone.
      if (kind === 'text' || upstream.response.headers.has('Content-Length')) {
        ctx.waitUntil(cacheStore(kind, target, language, res.clone()));
      }
      return withCors(res, origin, env);
    } catch (e) {
      return failFrom(e, origin, env, kind);
    }
  },
} satisfies ExportedHandler<Env>;
