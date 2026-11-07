// Prints every extraction candidate for one URL, to debug why a card picked what it picked.
//
//   npm run inspect -- https://example.com/story            # proxy on :8787 (npm run dev -w proxy)
//   npm run inspect -- https://example.com/story --proxy https://my-proxy.example.workers.dev
import { parseArgs } from 'node:util';
import { JSDOM } from 'jsdom';
import { PipelineError, resolveArticle } from '../web/src/net/pipeline.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    proxy: { type: 'string', default: 'http://localhost:8787' },
    origin: { type: 'string', default: 'http://localhost:5173' },
  },
});
const target = positionals[0];
if (!target) {
  console.error('Usage: npm run inspect -- <url> [--proxy <url>]');
  process.exit(2);
}

(globalThis as { DOMParser?: unknown }).DOMParser = new JSDOM('').window.DOMParser;

try {
  const m = await resolveArticle(target, {
    proxyUrl: values.proxy as string,
    headers: { Origin: values.origin as string, 'Accept-Language': 'en' },
    parseHtml: (html) => new JSDOM(html).window.document as unknown as Document,
    enrich: false,
  });
  const show = <T>(
    list: Array<{ value: T; source: string; score: number; note?: string }>,
    f: (v: T) => unknown,
  ) =>
    list.map(
      (c) =>
        `${c.score.toFixed(2)} ${c.source}${c.note ? `/${c.note}` : ''}: ${JSON.stringify(f(c.value))}`,
    );
  console.log(
    JSON.stringify(
      {
        status: m.status,
        reason: m.blockReason,
        cite: m.citeUrl,
        lang: m.lang,
        dir: m.dir,
        brand: m.brand,
        title: show(m.fields.title.options, (v) => v),
        description: show(m.fields.description.options, (v) => v),
        kicker: show(m.fields.kicker.options, (v) => v),
        siteName: show(m.fields.siteName.options, (v) => v),
        authors: show(m.fields.authors.options, (v) => v),
        published: show(m.fields.published.options, (v) => v.raw),
        images: show(m.imageCandidates, (v) => v.url),
        logos: show(m.logoCandidates, (v) => `${v.kind} ${v.url}`),
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error(e instanceof PipelineError ? `${e.code}: ${e.message}` : e);
  process.exit(1);
}
