import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// The capture-library spike (docs/decisions/0001-capture-library.md). Slow and noisy, so it only runs
// on request:  CAPTURE_SPIKE=1 npx playwright test spike --workers=1
test.skip(!process.env.CAPTURE_SPIKE, 'set CAPTURE_SPIKE=1 to run the capture-library spike');
test.use({ deviceScaleFactor: 2 });

const CONFIGS = [
  'fixture=standard&template=classic&theme=light&size=auto',
  'fixture=standard&template=split&theme=dark&size=16:9',
  'fixture=standard&template=headline&theme=brand&size=1:1',
  'fixture=cjk&template=classic&theme=light&size=auto',
  'fixture=arabic&template=split&theme=light&size=16:9',
  'fixture=emoji&template=classic&theme=dark&size=auto',
  'fixture=standard&template=classic&theme=mono&size=16:9',
  'fixture=standard&template=classic&theme=paper&size=4:5',
  'fixture=standard&template=classic&theme=light&size=auto&frame=1',
  'fixture=standard&template=split&theme=dark&size=16:9&frame=1&frameBg=blur',
  'fixture=hebrew&template=headline&theme=dark&size=9:16',
  'fixture=german&template=classic&theme=light&size=16:9',
  'fixture=italian&template=split&theme=paper&size=auto',
];
const LIBS = ['modern-screenshot', 'snapdom'] as const;

interface Run {
  config: string;
  lib: string;
  pass: 'first' | 'second';
  ms: number;
  differing: number;
  meanError: number;
  sizeMatches: boolean;
  reference?: number[];
  output?: number[];
  error?: string;
}

test('modern-screenshot vs snapdom', async ({ page, browserName }) => {
  test.setTimeout(600_000);
  const runs: Run[] = [];
  for (const config of CONFIGS) {
    for (const lib of LIBS) {
      // A fresh page per library: "first capture" must mean the first capture of the session.
      await page.goto(`/dev/gallery.html?${config}&spike=1`);
      await page.evaluate(
        () => (window as unknown as { __gallery: { ready: Promise<unknown> } }).__gallery.ready,
      );
      const reference = (
        await page.locator('.nc-frame, .nc-card').first().screenshot({ scale: 'device' })
      ).toString('base64');
      for (const pass of ['first', 'second'] as const) {
        try {
          const result = (await page.evaluate(
            async ({ lib, ref }) => {
              const spike = (
                window as unknown as {
                  __spike: {
                    capture(l: string, s: number): Promise<{ ms: number; dataUrl: string }>;
                    diff(a: string, b: string): Promise<Record<string, unknown>>;
                  };
                }
              ).__spike;
              const out = await spike.capture(lib, 2);
              return {
                ms: out.ms,
                dataUrl: out.dataUrl,
                ...(await spike.diff(`data:image/png;base64,${ref}`, out.dataUrl)),
              };
            },
            { lib, ref: reference },
          )) as {
            ms: number;
            dataUrl: string;
            differing: number;
            meanError: number;
            sizeMatches: boolean;
            reference: number[];
            output: number[];
          };
          if (process.env.CAPTURE_SPIKE_DUMP && pass === 'first') {
            const base = `${process.env.CAPTURE_SPIKE_OUT}.${browserName}.${CONFIGS.indexOf(config)}`;
            writeFileSync(`${base}.ref.png`, Buffer.from(reference, 'base64'));
            writeFileSync(
              `${base}.${lib}.png`,
              Buffer.from(result.dataUrl.split(',')[1] as string, 'base64'),
            );
          }
          runs.push({
            config,
            lib,
            pass,
            ms: Math.round(result.ms as number),
            differing: result.differing as number,
            meanError: result.meanError as number,
            sizeMatches: result.sizeMatches as boolean,
          });
        } catch (e) {
          runs.push({
            config,
            lib,
            pass,
            ms: 0,
            differing: 1,
            meanError: 255,
            sizeMatches: false,
            error: String(e).slice(0, 160),
          });
        }
      }
    }
  }
  const summary = LIBS.map((lib) => {
    const mine = runs.filter((r) => r.lib === lib && !r.error);
    const first = mine.filter((r) => r.pass === 'first');
    const second = mine.filter((r) => r.pass === 'second');
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
    return {
      browser: browserName,
      lib,
      errors: runs.filter((r) => r.lib === lib && r.error).length,
      firstMs: Math.round(avg(first.map((r) => r.ms))),
      secondMs: Math.round(avg(second.map((r) => r.ms))),
      firstDiffPct: +(avg(first.map((r) => r.differing)) * 100).toFixed(3),
      secondDiffPct: +(avg(second.map((r) => r.differing)) * 100).toFixed(3),
      worstDiffPct: +(Math.max(...mine.map((r) => r.differing)) * 100).toFixed(3),
      sizeMismatches: mine.filter((r) => !r.sizeMatches).length,
    };
  });
  const out = process.env.CAPTURE_SPIKE_OUT;
  if (out) writeFileSync(`${out}.${browserName}.json`, JSON.stringify({ summary, runs }, null, 2));
  console.log(`SPIKE ${browserName} ${JSON.stringify(summary)}`);
  expect(runs.length).toBe(CONFIGS.length * LIBS.length * 2);
});
