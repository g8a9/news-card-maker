// Checks the outlet registry (PLAN.md §6.1): its shape always, and with --proxy / --local that every logo and
// feed URL really loads through the fetch proxy. Run weekly by the smoke workflow.
//
//   npm run registry:check                     # shape only
//   npm run registry:check -- --local          # also load every logo and feed via `npm run dev -w proxy`
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { Outlet } from '../web/src/core/registry.ts';
import { fetchBlob, fetchText } from '../web/src/net/proxy.ts';

const { values: args } = parseArgs({
  options: {
    local: { type: 'boolean', default: false },
    proxy: { type: 'string' },
    origin: { type: 'string', default: 'http://localhost:5173' },
  },
});
const proxyUrl = args.proxy ?? (args.local ? 'http://localhost:8787' : undefined);
const outlets: Outlet[] = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'web/src/brand/outlets.json'), 'utf8'),
);

const problems: string[] = [];
const seen = new Set<string>();
const hex = /^#[0-9A-Fa-f]{6}$/;
const https = (u: string) => /^https:\/\//.test(u);

for (const o of outlets) {
  const at = `${o.id}:`;
  if (!/^[a-z0-9-]+$/.test(o.id))
    problems.push(`${at} id must be lower-case letters, digits and dashes`);
  if (seen.has(o.id)) problems.push(`${at} duplicate id`);
  seen.add(o.id);
  if (!o.name) problems.push(`${at} missing name`);
  if (!o.domains?.length) problems.push(`${at} needs at least one domain`);
  for (const d of o.domains ?? [])
    if (/[/:]/.test(d) || d !== d.toLowerCase())
      problems.push(`${at} domain "${d}" must be a bare lower-case host`);
  for (const c of [o.colors?.brand, o.colors?.paper])
    if (c && !hex.test(c)) problems.push(`${at} colour "${c}" must be #RRGGBB`);
  for (const l of Object.values(o.logo ?? {}))
    if (!https(l.url)) problems.push(`${at} logo URL must be https`);
  for (const f of o.feeds ?? []) if (!https(f)) problems.push(`${at} feed URL must be https`);
  if (o.fetch === 'blocked' && !o.feeds?.length)
    problems.push(`${at} a blocked outlet needs a feed`);
  if (!o.verified) problems.push(`${at} missing "verified" date`);
}

if (proxyUrl) {
  const headers = { Origin: args.origin as string, 'Accept-Language': 'en' };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (const o of outlets) {
    for (const [kind, logo] of Object.entries(o.logo ?? {})) {
      try {
        const blob = await fetchBlob(proxyUrl, logo.url, { headers });
        console.log(`ok   ${o.id} ${kind} logo ${blob.type} ${Math.round(blob.size / 1024)} KB`);
      } catch (e) {
        problems.push(`${o.id}: ${kind} logo failed (${(e as Error).message})`);
      }
    }
    for (const feed of o.feeds ?? []) {
      await sleep(2300); // stay under the proxy's 30 pages per minute
      try {
        const r = await fetchText(proxyUrl, feed, { headers });
        const text = new TextDecoder().decode(r.bytes.slice(0, 2000));
        if (r.upstreamStatus !== 200 || !/<(rss|feed|rdf)/i.test(text))
          throw new Error(`HTTP ${r.upstreamStatus}, not a feed`);
        console.log(`ok   ${o.id} feed ${feed}`);
      } catch (e) {
        problems.push(`${o.id}: feed ${feed} failed (${(e as Error).message})`);
      }
    }
  }
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(
  `registry ok: ${outlets.length} outlets${proxyUrl ? ', every logo and feed loads' : ''}`,
);
