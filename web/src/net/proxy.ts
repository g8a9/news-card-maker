// Client for the fetch proxy (PLAN.md §4). Text comes back as raw bytes plus X-* metadata headers;
// the caller decodes the charset. Never `Response.text()`.

export type ProxyErrorCode =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'INVALID_URL'
  | 'FORBIDDEN_TARGET'
  | 'ORIGIN_NOT_ALLOWED'
  | 'NOT_TEXT'
  | 'NOT_IMAGE'
  | 'IMAGE_TOO_LARGE'
  | 'UPSTREAM_UNREACHABLE'
  | 'UPSTREAM_HTTP_ERROR'
  | 'TOO_MANY_REDIRECTS'
  | 'UPSTREAM_TIMEOUT'
  | 'UNKNOWN';

export class ProxyRequestError extends Error {
  readonly code: ProxyErrorCode;
  readonly status: number;
  constructor(code: ProxyErrorCode, message: string, status = 0) {
    super(message);
    this.name = 'ProxyRequestError';
    this.code = code;
    this.status = status;
  }
  /** Worth one retry: the proxy or the site hiccuped. */
  get transient(): boolean {
    return (
      this.code === 'UPSTREAM_UNREACHABLE' ||
      this.code === 'UPSTREAM_TIMEOUT' ||
      this.status === 502 ||
      this.status === 504
    );
  }
}

export interface TextResult {
  bytes: Uint8Array;
  upstreamStatus: number;
  upstreamContentType: string;
  finalUrl: string;
  redirectCount: number;
  truncated: boolean;
  fetchMs: number;
}

export interface FetchOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Extra request headers, for example `Origin` and `Accept-Language` when running under Node. */
  headers?: Record<string, string>;
  /** Abort after this many ms (default 12 000 for text, 15 000 for images). */
  timeoutMs?: number;
}

export function proxyEndpoint(base: string, kind: 'text' | 'image', target: string): string {
  return `${base.replace(/\/+$/, '')}/api/${kind}?url=${encodeURIComponent(target)}`;
}

/** Combines the caller's signal with a timeout. (`AbortSignal.any` is missing in older Safari.) */
function withTimeout(
  signal: AbortSignal | undefined,
  ms: number,
): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('Timed out', 'TimeoutError')),
    ms,
  );
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

async function request(
  base: string,
  kind: 'text' | 'image',
  target: string,
  options: FetchOptions,
  defaultTimeout: number,
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const { signal, done } = withTimeout(options.signal, options.timeoutMs ?? defaultTimeout);
  try {
    const res = await fetchImpl(proxyEndpoint(base, kind, target), {
      signal,
      headers: options.headers,
    });
    if (res.ok) return res;
    let code: ProxyErrorCode = 'UNKNOWN';
    let message = `The proxy answered ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body.error?.code) code = body.error.code as ProxyErrorCode;
      if (body.error?.message) message = body.error.message;
    } catch {
      // Not our JSON error body: keep the generic message.
    }
    throw new ProxyRequestError(res.status === 429 ? 'RATE_LIMITED' : code, message, res.status);
  } catch (e) {
    if (e instanceof ProxyRequestError) throw e;
    const name = (e as { name?: string } | null)?.name;
    if (
      signal.aborted &&
      (name === 'TimeoutError' ||
        (signal.reason as { name?: string } | undefined)?.name === 'TimeoutError')
    ) {
      throw new ProxyRequestError('TIMEOUT', 'The fetch service took too long to answer');
    }
    if (name === 'AbortError') throw e; // the caller cancelled
    throw new ProxyRequestError('NETWORK', 'The fetch service is unavailable');
  } finally {
    done();
  }
}

export async function fetchText(
  base: string,
  target: string,
  options: FetchOptions = {},
): Promise<TextResult> {
  const res = await request(base, 'text', target, options, 12_000);
  const h = res.headers;
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    upstreamStatus: Number(h.get('X-Upstream-Status')) || 200,
    upstreamContentType: h.get('X-Upstream-Content-Type') ?? '',
    finalUrl: h.get('X-Final-Url') || target,
    redirectCount: Number(h.get('X-Redirect-Count')) || 0,
    truncated: h.get('X-Truncated') === '1',
    fetchMs: Number(h.get('X-Fetch-Ms')) || 0,
  };
}

export async function fetchBlob(
  base: string,
  target: string,
  options: FetchOptions = {},
): Promise<Blob> {
  const res = await request(base, 'image', target, options, 15_000);
  return res.blob();
}

/** Runs `task` once more, after `delayMs`, when it fails with a transient proxy error. */
export async function withRetry<T>(
  task: () => Promise<T>,
  delayMs = 1000,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await task();
  } catch (e) {
    if (!(e instanceof ProxyRequestError) || !e.transient || signal?.aborted) throw e;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return task();
  }
}
