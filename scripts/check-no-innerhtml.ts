// Fails when markup is injected through innerHTML-style APIs in web/src (PLAN.md §7.1, §12.4).
// Extracted strings must only ever reach the DOM through textContent / setAttribute.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN = join(ROOT, 'web', 'src');

/** Files allowed to use these APIs, with the reason. Keep this list empty if you can. */
const ALLOWLIST: Record<string, string> = {};

/** A line may opt out with this marker plus a reason, e.g. `// check-no-innerhtml: allow (reason)`. */
const MARKER = 'check-no-innerhtml: allow';

const PATTERNS: Array<[RegExp, string]> = [
  [/\.innerHTML\b/, 'innerHTML'],
  [/\.outerHTML\s*=(?!=)/, 'outerHTML assignment'],
  [/\binsertAdjacentHTML\b/, 'insertAdjacentHTML'],
  [/\bdocument\.write(ln)?\s*\(/, 'document.write'],
  [/\bsetHTMLUnsafe\b|\bparseHTMLUnsafe\b/, 'setHTMLUnsafe / parseHTMLUnsafe'],
];

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|js|html)$/.test(name)) yield path;
  }
}

const problems: string[] = [];
for (const file of walk(SCAN)) {
  const rel = relative(ROOT, file);
  if (rel in ALLOWLIST) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.includes(MARKER)) return;
    const code = line.replace(/\/\/.*$/, ''); // ignore trailing line comments
    for (const [pattern, label] of PATTERNS) {
      if (pattern.test(code)) problems.push(`${rel}:${i + 1}: ${label}`);
    }
  });
}

if (problems.length > 0) {
  console.error('Forbidden HTML-injection APIs found (use textContent / the h() helper):');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('check:html ok');
