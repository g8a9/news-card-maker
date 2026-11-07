import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';

export const PROXY = 'http://proxy.test';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers':
    'X-Upstream-Status, X-Upstream-Content-Type, X-Final-Url, X-Redirect-Count, X-Truncated, X-Fetch-Ms',
};

// ---- A minimal PNG encoder, so tests can serve real, decodable images -----------------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

/** A width × height RGB PNG with a diagonal gradient from `from` to `to`. */
export function png(
  width: number,
  height: number,
  from = [70, 110, 190],
  to = [230, 190, 120],
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, no interlace
  const rows = Buffer.alloc((1 + width * 3) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      for (let c = 0; c < 3; c++) {
        rows[row + 1 + x * 3 + c] = Math.round(
          (from[c] as number) * (1 - t) + (to[c] as number) * t,
        );
      }
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const fixture = (name: string): Buffer =>
  readFileSync(join(import.meta.dirname, '..', 'fixtures', 'pages', name));

// ---- Mocked proxy ----------------------------------------------------------------------------------
export interface TextReply {
  body: string | Buffer;
  status?: number;
  type?: string;
  finalUrl?: string;
}
export type PageReply = TextReply | { error: string; status: number } | 'abort';

export interface MockOptions {
  /** Pages by target URL. Unknown URLs answer 502 UPSTREAM_UNREACHABLE. */
  pages: Record<string, PageReply>;
  /** Image sizes by URL pattern; return 'fail' to make the proxy refuse. Default: 1200×630. */
  image?: (url: string) => { w: number; h: number } | 'fail';
}

export interface Mock {
  textRequests: string[];
  imageRequests: string[];
}

const defaultImage = (url: string): { w: number; h: number } | 'fail' => {
  if (/favicon\.ico/.test(url)) return 'fail';
  if (/wordmark|logo/.test(url)) return { w: 380, h: 120 };
  if (/apple-touch|icon/.test(url)) return { w: 180, h: 180 };
  return { w: 1200, h: 630 };
};

const errorBody = (code: string) => JSON.stringify({ error: { code, message: code } });

export async function mockProxy(page: Page, options: MockOptions): Promise<Mock> {
  const mock: Mock = { textRequests: [], imageRequests: [] };

  await page.route(/^http:\/\/proxy\.test\/api\/text\?/, async (route) => {
    const target = new URL(route.request().url()).searchParams.get('url') ?? '';
    mock.textRequests.push(target);
    const reply = options.pages[target];
    if (reply === 'abort') return route.abort('failed');
    if (!reply) {
      return route.fulfill({
        status: 502,
        headers: { ...CORS, 'content-type': 'application/json' },
        body: errorBody('UPSTREAM_UNREACHABLE'),
      });
    }
    if ('error' in reply) {
      return route.fulfill({
        status: reply.status,
        headers: { ...CORS, 'content-type': 'application/json' },
        body: errorBody(reply.error),
      });
    }
    return route.fulfill({
      status: 200,
      headers: {
        ...CORS,
        'content-type': 'text/plain',
        'x-upstream-status': String(reply.status ?? 200),
        'x-upstream-content-type': reply.type ?? 'text/html; charset=utf-8',
        'x-final-url': reply.finalUrl ?? target,
        'x-redirect-count': '0',
        'x-truncated': '0',
      },
      body: reply.body,
    });
  });

  await page.route(/^http:\/\/proxy\.test\/api\/image\?/, async (route) => {
    const target = new URL(route.request().url()).searchParams.get('url') ?? '';
    mock.imageRequests.push(target);
    const size = (options.image ?? defaultImage)(target);
    if (size === 'fail') {
      return route.fulfill({
        status: 502,
        headers: { ...CORS, 'content-type': 'application/json' },
        body: errorBody('UPSTREAM_HTTP_ERROR'),
      });
    }
    return route.fulfill({
      status: 200,
      headers: { ...CORS, 'content-type': 'image/png' },
      body: png(size.w, size.h),
    });
  });

  return mock;
}
