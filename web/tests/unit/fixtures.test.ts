import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractFixture, FIXTURE_DIR, summarize } from './helpers.ts';

// Each fixtures/pages/NAME.html is paired with NAME.expected.json, a snapshot of extract() and the
// blocked-page verdict. Regenerate after an intentional change with UPDATE_FIXTURES=1 and review the diff.
const files = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith('.html'))
  .sort();

describe('fixture snapshots', () => {
  it('has fixtures', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  for (const file of files) {
    it(file, () => {
      const { extraction, verdict } = extractFixture(file);
      const actual = {
        ...summarize(extraction),
        verdict: {
          blocked: verdict.blocked,
          kind: verdict.kind ?? null,
          quality: verdict.quality,
          structuredTitle: verdict.hasStructuredTitle,
        },
      };
      const expectedFile = join(FIXTURE_DIR, file.replace(/\.html$/, '.expected.json'));
      if (process.env.UPDATE_FIXTURES === '1') {
        writeFileSync(expectedFile, `${JSON.stringify(actual, null, 2)}\n`);
        return;
      }
      expect(actual).toEqual(JSON.parse(readFileSync(expectedFile, 'utf8')));
    });
  }
});
