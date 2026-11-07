// Error codes of the proxy contract (PLAN.md §4.6). Bodies are `{ "error": { "code", "message" } }`.

export type ErrorCode =
  | 'INVALID_URL'
  | 'FORBIDDEN_TARGET'
  | 'ORIGIN_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'IMAGE_TOO_LARGE'
  | 'NOT_TEXT'
  | 'NOT_IMAGE'
  | 'RATE_LIMITED'
  | 'UPSTREAM_UNREACHABLE'
  | 'UPSTREAM_HTTP_ERROR'
  | 'TOO_MANY_REDIRECTS'
  | 'UPSTREAM_TIMEOUT'
  // Not in the plan's table: an unexpected bug must not masquerade as an upstream failure.
  | 'INTERNAL_ERROR';

export const STATUS_FOR: Record<ErrorCode, number> = {
  INVALID_URL: 400,
  FORBIDDEN_TARGET: 403,
  ORIGIN_NOT_ALLOWED: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  IMAGE_TOO_LARGE: 413,
  NOT_TEXT: 415,
  NOT_IMAGE: 415,
  RATE_LIMITED: 429,
  UPSTREAM_UNREACHABLE: 502,
  UPSTREAM_HTTP_ERROR: 502,
  TOO_MANY_REDIRECTS: 502,
  UPSTREAM_TIMEOUT: 504,
  INTERNAL_ERROR: 500,
};

export class ProxyError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly headers: Record<string, string>;

  constructor(code: ErrorCode, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.name = 'ProxyError';
    this.code = code;
    this.status = STATUS_FOR[code];
    this.headers = headers;
  }
}

export function errorBody(code: ErrorCode, message: string): string {
  return JSON.stringify({ error: { code, message } });
}
