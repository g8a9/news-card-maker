import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { vi } from 'vitest';
import worker, { type Env } from '../src/index.ts';

export const ORIGIN = 'http://localhost:5173';
export const SELF = 'proxy.test';

export interface FakeLimiter extends RateLimit {
  keys: string[];
}

export function fakeLimiter(success = true): FakeLimiter {
  const keys: string[] = [];
  return {
    keys,
    async limit(options: RateLimitOptions) {
      keys.push(options.key);
      return { success };
    },
  };
}

export interface CallOptions {
  /** `null` sends no Origin header. Defaults to an allowed origin. */
  origin?: string | null;
  headers?: Record<string, string>;
  method?: string;
  env?: Partial<Env>;
}

export async function call(path: string, options: CallOptions = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin) headers.set('Origin', origin);
  const request = new Request(`https://${SELF}${path}`, {
    method: options.method ?? 'GET',
    headers,
  });
  const ctx = createExecutionContext();
  const testEnv = {
    ...(env as unknown as Env),
    ALLOWED_ORIGINS: `${ORIGIN},https://owner.github.io`,
    USER_AGENT:
      'Mozilla/5.0 (compatible; NewsCardMaker/1.0; +https://github.com/OWNER/news-card-maker)',
    RL_TEXT: fakeLimiter(),
    RL_IMAGE: fakeLimiter(),
    ...options.env,
  } satisfies Env;
  const res = await worker.fetch(request, testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export const textPath = (target: string) => `/api/text?url=${encodeURIComponent(target)}`;
export const imagePath = (target: string) => `/api/image?url=${encodeURIComponent(target)}`;

type Handler = (req: Request) => Response | Promise<Response>;

/** Replaces the global fetch so the Worker's outbound requests hit `handler` instead. */
export function mockUpstream(handler: Handler) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    return handler(new Request(input as RequestInfo, init));
  });
}

export const html = (body: string, headers: Record<string, string> = {}, status = 200) =>
  new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers },
  });

export const bytes = (...values: number[]) => new Uint8Array(values);

/** A tiny but real-looking file: signature bytes padded to `length`. */
export function fileWith(signature: number[], length = 64): Uint8Array {
  const out = new Uint8Array(length);
  out.set(signature);
  return out;
}

export const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const JPEG = [0xff, 0xd8, 0xff, 0xe0];
