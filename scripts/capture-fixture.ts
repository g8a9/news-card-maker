// Saves a head-only, body-stripped capture of a page for local debugging (PLAN.md §13.2).
// Output goes to web/tests/fixtures/live/ (gitignored): never commit third-party pages.
//
//   npm run capture-fixture -- https://example.com/story [--proxy http://localhost:8787]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { JSDOM } from 'jsdom';
import { decodeBytes } from '../web/src/core/charset.ts';
import { fetchText } from '../web/src/net/proxy.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    proxy: { type: 'string', default: 'http://localhost:8787' },
    origin: { type: 'string', default: 'http://localhost:5173' },
  },
});
const target = positionals[0];
if (!target) {
  console.error('Usage: npm run capture-fixture -- <url> [--proxy <url>]');
  process.exit(2);
}

const page = await fetchText(values.proxy as string, target, {
  headers: { Origin: values.origin as string, 'Accept-Language': 'en' },
});
const { text } = decodeBytes(page.bytes, page.upstreamContentType);
const doc = new JSDOM(text).window.document;

// Keep what extraction reads: the head, the headings and dates in the body. Drop everything else.
const keep = [...doc.querySelectorAll('h1, time[datetime], meta')].map((el) => el.outerHTML);
const head = doc.head.outerHTML;
const lang = doc.documentElement.getAttribute('lang') ?? '';
const header = JSON.stringify({
  pageUrl: page.finalUrl,
  inputUrl: target,
  status: page.upstreamStatus,
  contentType: 'text/html; charset=utf-8',
});
const out = `<!-- fixture ${header} -->\n<!doctype html>\n<html lang="${lang.replace(/"/g, '')}">\n${head}\n<body>\n${keep.join('\n')}\n</body>\n</html>\n`;

const dir = join(import.meta.dirname, '..', 'web', 'tests', 'fixtures', 'live');
mkdirSync(dir, { recursive: true });
const name = `${new URL(page.finalUrl).hostname.replace(/^www\./, '')}-${Date.now().toString(36)}.html`;
writeFileSync(join(dir, name), out);
console.log(`Saved ${join(dir, name)} (${out.length} bytes, from ${text.length})`);
