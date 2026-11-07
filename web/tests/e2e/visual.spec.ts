import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// Visual snapshots of the *exported* PNG for each template × theme × {auto, 16:9} (PLAN.md §13.4).
// Baselines are per platform (fonts render differently on each system) and kept for Chromium. Without a
// baseline for the current platform the tests are skipped; create them with
//   VISUAL_BASELINES=1 npx playwright test visual --project=chromium --update-snapshots
const TEMPLATES = ['classic', 'split', 'headline'];
const THEMES = ['light', 'dark', 'brand', 'paper', 'mono'];
const SIZES = ['auto', '16:9'];

type ExportWindow = Window & {
  __gallery: { ready: Promise<unknown> };
  __export: { png(scale: number): Promise<string> };
};

test.describe('exported PNG', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'visual baselines are kept for Chromium only',
  );

  for (const template of TEMPLATES) {
    for (const theme of THEMES) {
      for (const size of SIZES) {
        const file = `${template}-${theme}-${size.replace(':', 'x')}.png`;
        test(`${template} · ${theme} · ${size}`, async ({ page }, testInfo) => {
          test.skip(
            !existsSync(testInfo.snapshotPath(file)) && !process.env.VISUAL_BASELINES,
            'no baseline for this platform yet (see the comment at the top of this file)',
          );
          await page.goto(
            `/dev/gallery.html?fixture=standard&template=${template}&theme=${theme}&size=${size}&export=1`,
          );
          await page.evaluate(() => (window as unknown as ExportWindow).__gallery.ready);
          // Export at 1×, then shrink to 400 px wide in the page: small baselines, and less sensitive to
          // anti-aliasing than a full-size comparison.
          const base64 = await page.evaluate(async () => {
            const dataUrl = await (window as unknown as ExportWindow).__export.png(1);
            const img = new Image();
            img.src = dataUrl;
            await img.decode();
            const width = 400;
            const height = Math.round((img.naturalHeight * width) / img.naturalWidth);
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            (canvas.getContext('2d') as CanvasRenderingContext2D).drawImage(
              img,
              0,
              0,
              width,
              height,
            );
            return canvas.toDataURL('image/png').split(',')[1] as string;
          });
          expect(Buffer.from(base64, 'base64')).toMatchSnapshot(file);
        });
      }
    }
  }
});
