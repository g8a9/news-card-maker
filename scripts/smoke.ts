// Live smoke run (PLAN.md §13.5). Not a merge gate: it talks to real outlets through a running proxy.
//
//   npm run smoke -- --local            # proxy from `npm run dev -w proxy` on :8787
//   npm run smoke -- --proxy https://news-card-proxy.<account>.workers.dev
//
// For each outlet it takes the newest item of the outlet's feed (so the corpus never goes stale),
// runs the real pipeline on it with the extractor running in Node (jsdom), and writes a Markdown
// report. Outlets known to block automated reads are skipped unless --blocked is given; we only
// ever ask once, with our honest User-Agent, and we never try to get past a block.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { JSDOM } from 'jsdom';
import { decodeBytes } from '../web/src/core/charset.ts';
import type { Outlet } from '../web/src/core/registry.ts';
import type { ArticleModel } from '../web/src/core/types.ts';
import { effective } from '../web/src/core/types.ts';
import { PipelineError, resolveArticle } from '../web/src/net/pipeline.ts';
import { fetchBlob, fetchText } from '../web/src/net/proxy.ts';

const ROOT = new URL('..', import.meta.url).pathname;

const { values: args } = parseArgs({
  options: {
    local: { type: 'boolean', default: false },
    proxy: { type: 'string' },
    origin: { type: 'string', default: 'http://localhost:5173' },
    only: { type: 'string' },
    blocked: { type: 'boolean', default: false },
    out: { type: 'string', default: join(ROOT, 'smoke-report.md') },
    delay: { type: 'string', default: '400' },
    // A report that is safe to commit: found / missing instead of headlines, and no article addresses.
    redact: { type: 'boolean', default: false },
  },
});

const proxyUrl = args.proxy ?? (args.local ? 'http://localhost:8787' : undefined);
if (!proxyUrl) {
  console.error(
    'Usage: npm run smoke -- --local | --proxy <url> [--only "BBC"] [--blocked] [--redact] [--out file.md]',
  );
  process.exit(2);
}

// The extractor expects a DOMParser (entity decoding) and gets jsdom's parser for pages.
const sharedWindow = new JSDOM('').window;
(globalThis as { DOMParser?: unknown }).DOMParser = sharedWindow.DOMParser;
const parseHtml = (html: string): Document =>
  new JSDOM(html).window.document as unknown as Document;

const headers = { Origin: args.origin as string, 'Accept-Language': 'en' };

// The proxy allows 30 page fetches per minute per IP (approximately, per location). Stay well under it: one
// request every three seconds is 20 a minute.
let lastTextRequest = 0;
const pacedFetch: typeof fetch = async (input, init) => {
  if (String(input).includes('/api/text')) {
    const wait = lastTextRequest + 3000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastTextRequest = Date.now();
  }
  return fetch(input, init);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CorpusEntry {
  name: string;
  feed?: string;
  homepage?: string;
  homepageLink?: string;
  hackerNewsFront?: boolean;
  blocked?: boolean;
  url?: string;
}

function loadCorpus(): CorpusEntry[] {
  const entries: CorpusEntry[] = JSON.parse(
    readFileSync(join(ROOT, 'scripts/smoke-corpus.json'), 'utf8'),
  );
  const registryPath = join(ROOT, 'web/src/brand/outlets.json');
  if (existsSync(registryPath)) {
    const outlets: Outlet[] = JSON.parse(readFileSync(registryPath, 'utf8'));
    for (const o of outlets) {
      const known = entries.some((e) => e.name.toLowerCase() === o.name.toLowerCase());
      const feed = o.feeds?.[0];
      if (!known && feed) entries.push({ name: o.name, feed, blocked: o.fetch === 'blocked' });
    }
  }
  const extra = readFileSync(join(ROOT, 'scripts/smoke-urls.txt'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  for (const url of extra) entries.push({ name: new URL(url).hostname, url });
  return entries;
}

async function textOf(url: string): Promise<{ text: string; status: number }> {
  const res = await fetchText(proxyUrl as string, url, { headers, fetchImpl: pacedFetch });
  return { text: decodeBytes(res.bytes, res.upstreamContentType).text, status: res.upstreamStatus };
}

/** Newest item link of an RSS or Atom feed. */
function firstLink(xml: string): string | null {
  const doc = new JSDOM(xml, { contentType: 'text/xml' }).window.document;
  for (const item of doc.querySelectorAll('item, entry')) {
    const alt =
      item.querySelector('link[rel="alternate"][href]') ?? item.querySelector('link[href]');
    const href =
      alt?.getAttribute('href') ??
      item.querySelector('link')?.textContent ??
      item.querySelector('guid')?.textContent;
    if (href && /^https?:\/\//i.test(href.trim())) return href.trim();
  }
  return null;
}

async function pickUrl(entry: CorpusEntry): Promise<{ url: string; via: string }> {
  if (entry.url) return { url: entry.url, via: 'smoke-urls.txt' };
  if (entry.hackerNewsFront) {
    const ids = (await (
      await fetch('https://hacker-news.firebaseio.com/v0/topstories.json')
    ).json()) as number[];
    return { url: `https://news.ycombinator.com/item?id=${ids[0]}`, via: 'HN top stories' };
  }
  let feedError = '';
  if (entry.feed) {
    try {
      const link = firstLink((await textOf(entry.feed)).text);
      if (link) return { url: link, via: 'feed' };
      feedError = 'feed had no item links';
    } catch (e) {
      feedError = `feed failed: ${(e as Error).message}`;
    }
  }
  if (entry.homepage && entry.homepageLink) {
    const html = (await textOf(entry.homepage)).text;
    const m = new RegExp(entry.homepageLink).exec(html);
    if (m) return { url: m[0], via: 'homepage' };
  }
  throw new Error(feedError || 'no way to find an article');
}

interface Row {
  name: string;
  url: string;
  via: string;
  status: string;
  title: string;
  site: string;
  image: string;
  date: string;
  logo: string;
  notes: string[];
  ok: boolean;
  needsImage: boolean;
}

async function probeImage(ref: string): Promise<string> {
  try {
    const blob = await fetchBlob(proxyUrl as string, ref, { headers });
    return `${blob.type || 'image'} ${Math.round(blob.size / 1024)} KB`;
  } catch (e) {
    return `FAILED (${(e as Error).message})`;
  }
}

function describe(model: ArticleModel) {
  const title = effective(model.fields.title) ?? '';
  const site = effective(model.fields.siteName) ?? '';
  const published = model.fields.published.value;
  const date = published
    ? `${published.y}-${String(published.m).padStart(2, '0')}-${String(published.d).padStart(2, '0')}`
    : '';
  return { title, site, date };
}

async function run(entry: CorpusEntry): Promise<Row> {
  const row: Row = {
    name: entry.name,
    url: '',
    via: '',
    status: '',
    title: '',
    site: '',
    image: '',
    date: '',
    logo: '',
    notes: [],
    ok: false,
    needsImage: !entry.hackerNewsFront && !/ycombinator/.test(entry.url ?? ''),
  };
  try {
    const picked = await pickUrl(entry);
    row.url = picked.url;
    row.via = picked.via;
    const model = await resolveArticle(picked.url, {
      proxyUrl: proxyUrl as string,
      headers,
      parseHtml,
      enrich: false,
    });
    row.status = model.status + (model.blockReason ? ` (${model.blockReason})` : '');
    const d = describe(model);
    Object.assign(row, d);
    const imageRef = model.imageCandidates[0]?.value.url;
    row.image = imageRef ? await probeImage(imageRef) : 'none found';
    const logoRef = model.logoCandidates[0]?.value;
    row.logo = logoRef ? `${logoRef.kind}: ${await probeImage(logoRef.url)}` : 'none found';
    if (model.status === 'blocked') row.notes.push('blocked: bookmarklet, paste or manual needed');
    if (model.status === 'partial') row.notes.push('partial');
    const imageOk = !row.needsImage || (!!imageRef && !row.image.startsWith('FAILED'));
    row.ok = model.status !== 'blocked' && !!d.title && !!d.site && !!d.date && imageOk;
  } catch (e) {
    row.status = e instanceof PipelineError ? `${e.code}` : 'error';
    row.notes.push((e as Error).message);
  }
  return row;
}

const cell = (s: string, max = 60) =>
  (s.length > max ? `${s.slice(0, max - 1)}…` : s).replace(/\|/g, '\\|');

async function main() {
  let corpus = loadCorpus();
  if (!args.blocked) corpus = corpus.filter((e) => !e.blocked);
  if (args.only)
    corpus = corpus.filter((e) =>
      e.name.toLowerCase().includes((args.only as string).toLowerCase()),
    );

  const rows: Row[] = [];
  for (const entry of corpus) {
    const row = await run(entry);
    rows.push(row);
    console.log(
      `${row.ok ? 'ok  ' : 'FAIL'} ${row.name.padEnd(24)} ${cell(row.title, 50).padEnd(50)} | ${cell(row.site, 20)} | ${row.date || '-'} | img: ${cell(row.image, 24)} | ${row.status}`,
    );
    await sleep(Number(args.delay));
  }

  const cooperative = rows.filter(
    (r) => r.status !== '' && !r.notes.some((n) => n.startsWith('blocked')),
  );
  const good = rows.filter((r) => r.ok).length;
  const lines = [
    `# Smoke report (${new Date().toISOString()})`,
    '',
    `Proxy: ${proxyUrl}. ${good} of ${rows.length} outlets got title, site, date and an image that loads (Hacker News needs no image).`,
    `Read the table, not just the counts: a field can be present and wrong.`,
    '',
    '| Outlet | Result | Status | Title | Site | Date | Image | Logo candidate | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.name} | ${r.ok ? 'ok' : 'FAIL'} | ${cell(r.status, 40)} | ${args.redact ? (r.title ? 'found' : 'missing') : cell(r.title, 70)} | ${cell(r.site, 24)} | ${r.date || '-'} | ${cell(r.image, 30)} | ${cell(r.logo, 40)} | ${cell(r.notes.join('; '), 80)} |`,
    ),
    '',
    ...(args.redact
      ? ['Headlines and article addresses are left out of this copy of the report.', '']
      : [
          '## URLs',
          '',
          ...rows.map((r) => `- ${r.name} (${r.via || 'n/a'}): ${r.url || '-'}`),
          '',
        ]),
  ];
  writeFileSync(args.out as string, lines.join('\n'));
  console.log(`\n${good}/${rows.length} ok (${cooperative.length} reachable). Report: ${args.out}`);
}

await main();
