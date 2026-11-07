// The app as GitHub Pages serves it: a project site under /<repository>/, built with its base path,
// the proxy address and the repository link baked in, and the CSP in place (PLAN.md §14, M7).
import { expect, test } from '@playwright/test';
import { fixture, mockProxy } from './helpers.ts';

const SITE = 'http://localhost:4174/news-card-maker/';
const COURIER =
  'https://www.thecourier.test/transport/2026/nov/06/council-approves-harbour-tram-line';

test.use({ baseURL: SITE });

test('loads from under its base path with nothing missing', async ({ page }) => {
  const missing: string[] = [];
  page.on('response', (r) => {
    if (r.url().startsWith('http://localhost:4174') && r.status() >= 400)
      missing.push(`${r.status()} ${r.url()}`);
  });
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });

  // Every image answers, so a console error can only mean something of the app's own is broken.
  await mockProxy(page, {
    pages: { [COURIER]: { body: fixture('courier-like-overlay.html') } },
    image: () => ({ w: 1200, h: 630 }),
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'News Card Maker' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Source code on GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/example/news-card-maker',
  );

  await page.getByLabel('News article link').fill(COURIER);
  await page.keyboard.press('Enter');
  await expect(page.locator('.stage-scaler .nc-headline')).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('data-pipeline', 'done');
  await expect(page.locator('.stage')).toHaveAttribute('data-rendering', 'false');

  // Fonts, the stylesheet and the script all came from the base path, and nothing blocked or broke.
  const fontsReady = await page.evaluate(
    () => document.fonts.check('600 32px "Newsreader Variable"') && document.fonts.size > 0,
  );
  expect(fontsReady).toBe(true);
  expect(missing).toEqual([]);
  expect(problems).toEqual([]);

  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(policy).toContain('connect-src');
  expect(policy).toContain('http://proxy.test');
});

test('the link, a reload and the bookmarklet all stay under the base path', async ({ page }) => {
  await mockProxy(page, { pages: { [COURIER]: { body: fixture('courier-like-overlay.html') } } });
  await page.goto(`./?url=${encodeURIComponent(COURIER)}`);
  await expect(page.locator('.stage-scaler .nc-headline')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/news-card-maker/');
  expect(new URL(page.url()).searchParams.get('url')).toBe(COURIER);

  await page.reload();
  await expect(page.locator('.stage-scaler .nc-headline')).toBeVisible();

  await page.getByRole('button', { name: 'Bookmarklet' }).first().click();
  const href = (await page.locator('a.bookmarklet-link').getAttribute('href')) ?? '';
  expect(decodeURI(href)).toContain(`${SITE}#bm=`);
});
