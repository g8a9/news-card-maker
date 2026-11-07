import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { fixture, openCard, pngSize } from './helpers.ts';

const COURIER =
  'https://www.thecourier.test/transport/2026/nov/06/council-approves-harbour-tram-line';
const pages = { [COURIER]: { body: fixture('courier-like-overlay.html') } };
const FILE = 'the-courier-2026-11-06-council-approves-harbour-tram-line-after';

/** The size shown under the preview, as [width, height]. */
async function readout(page: Page): Promise<[number, number]> {
  const text = (await page.locator('#px-readout').textContent()) ?? '';
  const [w, h] = text.match(/\d+/g)?.map(Number) ?? [0, 0];
  return [w as number, h as number];
}

async function download(page: Page, format: 'PNG' | 'JPEG' | 'WebP') {
  const waiting = page.waitForEvent('download');
  await page.locator('#download-btn').click();
  await page.getByRole('menuitem', { name: format }).click();
  const file = await waiting;
  const bytes = readFileSync((await file.path()) as string);
  return { name: file.suggestedFilename(), bytes };
}

test.describe('copy', () => {
  test('puts a PNG of the card on the clipboard (Chromium)', async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'only Chromium lets a test read the clipboard back');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openCard(page, COURIER, pages);
    await page.locator('#copy-btn').click();
    const toast = page.locator('.toast-success');
    await expect(toast).toHaveText(/^Copied \d+×\d+ PNG$/);
    const [w, h] = ((await toast.textContent()) ?? '').match(/\d+/g)?.map(Number) ?? [0, 0];

    const clip = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read();
      const blob = await (item as ClipboardItem).getType('image/png');
      const bitmap = await createImageBitmap(blob);
      return { types: (item as ClipboardItem).types, width: bitmap.width, height: bitmap.height };
    });
    expect(clip.types).toEqual(['image/png']);
    expect([clip.width, clip.height]).toEqual([w, h]); // the toast tells the truth
    expect(clip.width).toBe(2400); // 1200 logical px at the default 2×
    await expect.poll(() => readout(page)).toEqual([w, h]); // and so does the size under the preview
  });

  test('either copies or explains itself, in every engine', async ({ page }) => {
    await openCard(page, COURIER, pages);
    await page.locator('#copy-btn').click();
    await expect(page.locator('.toast-success, dialog[open]')).toBeVisible();
  });

  test('shows the image to copy by hand when the browser refuses', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator.clipboard, 'write', {
        value: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
      });
    });
    await openCard(page, COURIER, pages);
    await page.locator('#copy-btn').click();
    const dialog = page.getByRole('dialog', { name: 'Copy the image' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('img', { name: 'The exported card' })).toBeVisible();
    expect(
      await dialog.locator('img').evaluate((img) => (img as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(1000);
    const waiting = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download' }).click();
    expect((await waiting).suggestedFilename()).toBe(`${FILE}.png`);
  });

  test('Ctrl/⌘ C copies when no field has focus', async ({ page }) => {
    await openCard(page, COURIER, pages);
    await page.locator('body').click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('ControlOrMeta+C');
    await expect(page.locator('.toast-success, dialog[open]')).toBeVisible();
  });
});

test.describe('download', () => {
  test('PNG: readable name, real PNG, the size shown under the preview', async ({ page }) => {
    await openCard(page, COURIER, pages);
    const [w, h] = await readout(page);
    const { name, bytes } = await download(page, 'PNG');
    expect(name).toBe(`${FILE}.png`);
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(pngSize(bytes)).toEqual([w, h]);
    expect(w).toBe(2400);
  });

  test('JPEG: a real JPEG', async ({ page }) => {
    await openCard(page, COURIER, pages);
    const { name, bytes } = await download(page, 'JPEG');
    expect(name).toBe(`${FILE}.jpg`);
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  test('WebP: a WebP where the browser can encode one, otherwise no WebP item at all', async ({
    page,
  }) => {
    await openCard(page, COURIER, pages);
    await page.locator('#download-btn').click();
    // Mirrors the app's rule: canvas WebP support, except Firefox where snapdom's WebP export never settles.
    const canEncode = await page.evaluate(
      () =>
        document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp') &&
        !/Firefox\//.test(navigator.userAgent),
    );
    await expect(page.getByRole('menuitem', { name: 'WebP' })).toHaveCount(canEncode ? 1 : 0);
    await page.keyboard.press('Escape');
    test.skip(!canEncode, 'this browser cannot encode WebP, so the menu does not offer it');
    const { name, bytes } = await download(page, 'WebP');
    expect(name).toBe(`${FILE}.webp`);
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(bytes.subarray(8, 12).toString('ascii')).toBe('WEBP');
  });

  test('Ctrl/⌘ S downloads in the chosen format', async ({ page }) => {
    await openCard(page, COURIER, pages);
    const waiting = page.waitForEvent('download');
    await page.keyboard.press('ControlOrMeta+S');
    expect((await waiting).suggestedFilename()).toBe(`${FILE}.png`);
  });

  test('the scale setting changes the exported size', async ({ page }) => {
    await openCard(page, COURIER, pages);
    await page.locator('#section-export-head').click();
    await page.getByRole('radio', { name: '1×' }).click();
    await expect(page.locator('#px-readout')).toContainText('1200 ×');
    const [w, h] = await readout(page);
    const { bytes } = await download(page, 'PNG');
    expect(pngSize(bytes)).toEqual([w, h]);
  });

  test('a frame makes the picture larger by its padding', async ({ page }) => {
    await openCard(page, COURIER, pages);
    await page.locator('#section-frame-head').click();
    await page.getByRole('switch', { name: 'Frame', exact: true }).click();
    await expect(page.locator('.stage-scaler .nc-frame')).toBeVisible();
    await expect(page.locator('#px-readout')).toContainText('2688 ×'); // (1200 + 2 × 6u) × 2
    const [w, h] = await readout(page);
    const { bytes } = await download(page, 'PNG');
    expect(pngSize(bytes)).toEqual([w, h]);
  });

  test('the scale guard reduces an export that would be too big and says so', async ({ page }) => {
    await openCard(page, COURIER, pages);
    await page.getByLabel('Size', { exact: true }).selectOption('custom');
    await page.getByLabel('Custom width in pixels').fill('2000');
    await page.getByLabel('Custom width in pixels').press('Tab'); // a real blur: Firefox crashes on a synthetic change event
    await page.getByLabel('Custom height in pixels').fill('2000');
    await page.getByLabel('Custom height in pixels').press('Tab');
    await page.locator('#section-export-head').click();
    await page.getByRole('radio', { name: '4×' }).click();
    await expect(page.locator('#px-readout')).toContainText('(reduced)');
    const [w, h] = await readout(page);
    expect(w * h).toBeLessThanOrEqual(50_000_000);
    expect(w).toBeGreaterThan(3000);
  });
});
