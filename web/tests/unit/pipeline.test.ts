import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Outlet } from '../../src/core/registry.ts';
import type { ArticleModel } from '../../src/core/types.ts';
import {
  loadLinkedImage,
  PipelineError,
  type PipelineEvent,
  type PipelineOptions,
  resolveArticle,
  resolveFromHtml,
} from '../../src/net/pipeline.ts';
import { NOW, readFixture } from './helpers.ts';

const PROXY = 'http://proxy.test';

interface TextReply {
  status?: number;
  bytes: Uint8Array | string;
  type?: string;
  finalUrl?: string;
}

interface Rig {
  text: (target: string) => TextReply | { error: string; status: number } | undefined;
  image?: (target: string) => { w: number; h: number; type?: string } | 'fail';
  hn?: (id: string) => unknown;
}

/** A fake fetch standing in for the proxy, the HN API and the network between them. */
function rig(config: Rig) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string) => {
    const url = String(input);
    calls.push(url);
    const hn = /^https:\/\/hacker-news\.firebaseio\.com\/v0\/item\/(\d+)\.json$/.exec(url);
    if (hn) return new Response(JSON.stringify(config.hn?.(hn[1] as string) ?? null));
    const m = /^http:\/\/proxy\.test\/api\/(text|image)\?url=(.*)$/.exec(url);
    if (!m) throw new Error(`unexpected request ${url}`);
    const target = decodeURIComponent(m[2] as string);
    if (m[1] === 'text') {
      const reply = config.text(target);
      if (!reply) return errorResponse(502, 'UPSTREAM_UNREACHABLE');
      if ('error' in reply) return errorResponse(reply.status, reply.error);
      const bytes =
        typeof reply.bytes === 'string' ? new TextEncoder().encode(reply.bytes) : reply.bytes;
      return new Response(bytes as BodyInit, {
        headers: {
          'X-Upstream-Status': String(reply.status ?? 200),
          'X-Upstream-Content-Type': reply.type ?? 'text/html; charset=utf-8',
          'X-Final-Url': reply.finalUrl ?? target,
          'X-Redirect-Count': '0',
          'X-Truncated': '0',
        },
      });
    }
    const img = config.image?.(target) ?? 'fail';
    if (img === 'fail') return errorResponse(502, 'UPSTREAM_HTTP_ERROR');
    return new Response(new TextEncoder().encode(`${img.w}x${img.h}`), {
      headers: { 'Content-Type': img.type ?? 'image/jpeg' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const errorResponse = (status: number, code: string) =>
  new Response(JSON.stringify({ error: { code, message: code } }), { status });

/** The "decoder": image bytes are the text "WxH", so tests control every image's size. */
const decode = async (blob: Blob) => {
  const [w, h] = (await blob.text()).split('x').map(Number);
  return { width: w as number, height: h as number };
};

const fixtureReply = (file: string): TextReply => {
  const { bytes, meta } = readFixture(file);
  return {
    bytes,
    status: meta.status,
    type: meta.contentType ?? 'text/html; charset=utf-8',
    finalUrl: meta.pageUrl,
  };
};

beforeEach(() => {
  let n = 0;
  URL.createObjectURL = () => `blob:test/${++n}`;
  URL.revokeObjectURL = () => {};
});
afterEach(() => vi.restoreAllMocks());

const options = (
  r: { fetchImpl: typeof fetch },
  extra: Partial<PipelineOptions> = {},
): PipelineOptions => ({
  proxyUrl: PROXY,
  fetchImpl: r.fetchImpl,
  decode,
  now: NOW,
  retryDelayMs: 1,
  ...extra,
});

const COURIER =
  'https://www.thecourier.test/transport/2026/nov/06/council-approves-harbour-tram-line';

describe('resolveArticle: the direct path', () => {
  it('extracts, then loads images and logos, emitting progressive events', async () => {
    const r = rig({
      text: () => fixtureReply('courier-like-overlay.html'),
      image: (target) => (target.includes('wordmark') ? { w: 380, h: 120 } : { w: 1200, h: 630 }),
    });
    const events: PipelineEvent[] = [];
    const model = await resolveArticle(
      `${COURIER}?CMP=share_btn_url`,
      options(r, { onEvent: (e) => events.push(e) }),
    );

    expect(events[0]?.stage).toBe('content');
    expect(events[0]?.model.fields.title.value).toBe(
      'Council approves harbour tram line after late vote',
    );
    expect(events[0]?.model.fields.image.value).toBeNull(); // text first, images later
    expect(events.at(-1)?.stage).toBe('done');
    expect(new Set(events.map((e) => e.stage))).toEqual(
      new Set(['content', 'image', 'logo', 'done']),
    );

    expect(model.status).toBe('ok');
    expect(model.provenance).toEqual(['proxy']);
    expect(model.citeUrl).toBe(COURIER);
    expect(model.fields.siteName.value).toBe('The Courier');
    expect(model.fields.image.value?.width).toBe(1200);
    expect(model.fields.image.options.length).toBeGreaterThanOrEqual(2);
    expect(model.fields.logo.value?.ref.kind).toBe('wordmark');
    expect(model.fields.logo.value?.analysis?.aspect).toBeCloseTo(3.17, 1);
  });

  it('asks the proxy for the page the user pasted, not a cleaned-up one', async () => {
    const r = rig({ text: () => fixtureReply('courier-like-overlay.html') });
    await resolveArticle(`  ${COURIER}?CMP=share_btn_url `, options(r, { enrich: false }));
    expect(decodeURIComponent(r.calls[0] ?? '')).toContain(`${COURIER}?CMP=share_btn_url`);
  });

  it('decodes ISO-8859-1 pages', async () => {
    const r = rig({ text: () => fixtureReply('corriera-like-latin1.html') });
    const model = await resolveArticle(
      'https://www.corriera.test/cronache/26_novembre_06/citta-ponte-chiuso-1234.shtml',
      options(r, { enrich: false }),
    );
    expect(model.fields.title.value).toBe('Città, il ponte resta chiuso fino a marzo');
    expect(model.fields.siteName.value).toBe('Corriera della Città');
  });

  it('uses the registry: outlet name, brand colour and a title suffix', async () => {
    const outlet: Outlet = {
      id: 'courier',
      name: 'The Courier Group',
      domains: ['thecourier.test'],
      colors: { brand: '#112233' },
    };
    const r = rig({ text: () => fixtureReply('courier-like-overlay.html') });
    const model = await resolveArticle(COURIER, options(r, { outlets: [outlet], enrich: false }));
    expect(model.fields.siteName.value).toBe('The Courier Group');
    expect(model.brand).toMatchObject({ outletId: 'courier', color: '#112233' });
  });

  it('survives images and logos that fail to load', async () => {
    const r = rig({ text: () => fixtureReply('courier-like-overlay.html'), image: () => 'fail' });
    const model = await resolveArticle(COURIER, options(r));
    expect(model.status).toBe('ok');
    expect(model.fields.image.value).toBeNull();
    expect(model.fields.logo.value).toBeNull();
    expect(model.fields.title.value).toBeTruthy();
  });

  it('rejects logos that are too small or the wrong shape', async () => {
    const r = rig({
      text: () => fixtureReply('diario-like-legal-entity.html'),
      image: (t) =>
        t.includes('newsletter')
          ? { w: 379, h: 975 }
          : t.includes('favicon')
            ? { w: 16, h: 16 }
            : { w: 1200, h: 800 },
    });
    const model = await resolveArticle(
      'https://elperiodico.test/espana/20261106/aprobado-plan-vivienda-1.html',
      options(r),
    );
    expect(model.fields.logo.value).toBeNull(); // portrait newsletter image and a 16 px favicon
    expect(model.fields.image.value?.width).toBe(1200);
  });

  it('does not enrich blocked pages', async () => {
    const r = rig({ text: () => fixtureReply('cloudflare-challenge.html') });
    const events: PipelineEvent[] = [];
    const model = await resolveArticle(
      'https://www.economy-weekly.test/leaders/2026/11/05/the-case-for-patience',
      options(r, { onEvent: (e) => events.push(e) }),
    );
    expect(model.status).toBe('blocked');
    expect(model.blockReason).toBeTruthy();
    expect(events.map((e) => e.stage)).toEqual(['content', 'done']);
    expect(r.calls.some((c) => c.includes('/api/image'))).toBe(false);
  });

  it('retries once after a transient proxy failure', async () => {
    let attempt = 0;
    const r = rig({
      text: () =>
        ++attempt === 1
          ? { error: 'UPSTREAM_TIMEOUT', status: 504 }
          : fixtureReply('minimal-title-only.html'),
    });
    const model = await resolveArticle(
      'https://blog.example.test/post/1',
      options(r, { enrich: false }),
    );
    expect(attempt).toBe(2);
    expect(model.fields.title.value).toBe('My weekend notes');
    expect(model.status).toBe('partial');
  });
});

describe('resolveArticle: errors', () => {
  const failWith = async (input: string, r: ReturnType<typeof rig>) => {
    try {
      await resolveArticle(input, options(r, { enrich: false }));
    } catch (e) {
      return e as PipelineError;
    }
    throw new Error('expected failure');
  };

  it('rejects input that is not a link', async () => {
    const e = await failWith('hello there', rig({ text: () => undefined }));
    expect(e).toBeInstanceOf(PipelineError);
    expect(e.code).toBe('INVALID_INPUT');
    expect(e.message).toBe('Paste a full link, starting with https://');
  });

  it('maps a rate limit', async () => {
    const e = await failWith(
      'https://e.com/a',
      rig({ text: () => ({ error: 'RATE_LIMITED', status: 429 }) }),
    );
    expect(e.code).toBe('RATE_LIMITED');
  });

  it('maps an unreachable proxy', async () => {
    const down = {
      fetchImpl: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    };
    const e = await failWith('https://e.com/a', down as ReturnType<typeof rig>);
    expect(e.code).toBe('PROXY_UNAVAILABLE');
  });

  it('maps an origin that the proxy refuses to PROXY_UNAVAILABLE', async () => {
    const e = await failWith(
      'https://e.com/a',
      rig({ text: () => ({ error: 'ORIGIN_NOT_ALLOWED', status: 403 }) }),
    );
    expect(e.code).toBe('PROXY_UNAVAILABLE');
  });

  it('maps other proxy failures to FETCH_FAILED', async () => {
    const e = await failWith(
      'https://e.com/a',
      rig({ text: () => ({ error: 'NOT_TEXT', status: 415 }) }),
    );
    expect(e.code).toBe('FETCH_FAILED');
  });
});

describe('Hacker News adapter through the pipeline', () => {
  const item = {
    id: 4242,
    type: 'story',
    by: 'dhouston',
    time: 1_794_000_000,
    title: 'Show HN: A tiny static site generator',
    url: 'https://www.example.test/ssg',
    score: 412,
    descendants: 113,
  };

  it('builds a card from the API without touching the HN page', async () => {
    const r = rig({
      text: () => undefined,
      hn: () => item,
      image: () => ({ w: 40, h: 40, type: 'image/svg+xml' }),
    });
    const model = await resolveArticle('https://news.ycombinator.com/item?id=4242', options(r));
    expect(model.provenance).toEqual(['adapter']);
    expect(model.fields.title.value).toBe('A tiny static site generator');
    expect(model.fields.kicker.value).toBe('Show HN');
    expect(model.fields.siteName.value).toBe('Hacker News');
    expect(model.brand.color).toBe('#FF6600');
    expect(model.citeUrl).toBe('https://news.ycombinator.com/item?id=4242');
    expect(model.extras?.hn).toEqual({
      points: 412,
      comments: 113,
      by: 'dhouston',
      linkUrl: 'https://www.example.test/ssg',
    });
    expect(model.fields.logo.value?.ref.url).toBe('https://news.ycombinator.com/y18.svg');
    expect(r.calls.some((c) => c.includes('/api/text'))).toBe(false);
  });

  it('refuses comments with a pointer to the story', async () => {
    const r = rig({ text: () => undefined, hn: () => ({ id: 9, type: 'comment', parent: 4242 }) });
    const e = await resolveArticle(
      'https://news.ycombinator.com/item?id=9',
      options(r, { enrich: false }),
    ).catch((x) => x);
    expect(e).toMatchObject({
      code: 'HN_COMMENT',
      link: 'https://news.ycombinator.com/item?id=4242',
    });
  });

  it('reports a missing item', async () => {
    const r = rig({ text: () => undefined, hn: () => null });
    const e = await resolveArticle(
      'https://news.ycombinator.com/item?id=1',
      options(r, { enrich: false }),
    ).catch((x) => x);
    expect(e).toMatchObject({ code: 'HN_UNAVAILABLE' });
  });

  it('can borrow the linked article image', async () => {
    const r = rig({
      text: (t) =>
        t.startsWith('https://www.example.test/')
          ? fixtureReplyFor('placeholder-images.html', t)
          : undefined,
      hn: () => item,
      image: () => ({ w: 1600, h: 900 }),
    });
    const model = await resolveArticle(
      'https://news.ycombinator.com/item?id=4242',
      options(r, { enrich: false }),
    );
    const image = await loadLinkedImage(model, options(r));
    expect(image?.width).toBe(1600);
    expect(image?.ref.url).toContain('sites/default/files');
  });
});

const fixtureReplyFor = (file: string, finalUrl: string): TextReply => ({
  ...fixtureReply(file),
  finalUrl,
});

describe('resolveFromHtml (bookmarklet and pasted source)', () => {
  it('builds a model from supplied HTML and records the provenance', async () => {
    const r = rig({ text: () => undefined, image: () => ({ w: 1200, h: 630 }) });
    const html = new TextDecoder().decode(readFixture('courier-like-overlay.html').bytes);
    const model = await resolveFromHtml(html, COURIER, 'paste', options(r));
    expect(model.provenance).toEqual(['paste']);
    expect(model.fields.title.value).toBe('Council approves harbour tram line after late vote');
    expect(model.fields.image.value).not.toBeNull();
    expect(r.calls.every((c) => c.includes('/api/image'))).toBe(true); // the page itself is never fetched
  });

  it('flags a pasted challenge page as blocked', async () => {
    const html = new TextDecoder().decode(readFixture('cloudflare-challenge.html').bytes);
    const model = await resolveFromHtml(
      html,
      'https://www.economy-weekly.test/x',
      'paste',
      options(rig({ text: () => undefined })),
    );
    expect(model.status).toBe('blocked');
  });
});

describe('type surface', () => {
  it('keeps ArticleModel assignable for UI code', () => {
    const check = (m: ArticleModel) => m.fields.title.options.length;
    expect(typeof check).toBe('function');
  });
});
