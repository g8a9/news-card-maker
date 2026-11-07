// M6: what happens when a page cannot be read automatically, and the other ways in
// (PLAN.md §9.5, §11, §13.4): paste source, drop a saved page, the bookmarklet, manual mode.
import { expect, type Page, test } from '@playwright/test';
import { fixture, mockProxy } from './helpers.ts';

const ORIGIN = 'https://www.thecourier.test';
const COURIER = `${ORIGIN}/transport/2026/nov/06/council-approves-harbour-tram-line`;
const BLOCKED = 'https://www.economy-weekly.test/leaders/2026/11/05/the-case-for-patience';
const NOTES = 'https://blog.example.test/post/1';
const HEADLINE = 'Council approves harbour tram line after late vote';

const courierHtml = () => fixture('courier-like-overlay.html').toString('utf8');

const pages = {
  [BLOCKED]: { body: fixture('cloudflare-challenge.html'), status: 403 },
  [NOTES]: { body: fixture('minimal-title-only.html') },
};

const headline = (page: Page) => page.locator('.stage-scaler .nc-headline');

async function settled(page: Page) {
  await expect(page.locator('#app')).toHaveAttribute('data-pipeline', 'done');
  await expect(page.locator('.stage')).toHaveAttribute('data-rendering', 'false');
}

async function tryLink(page: Page, url: string) {
  await page.getByLabel('News article link').fill(url);
  await page.keyboard.press('Enter');
}

test.describe('a page that cannot be read', () => {
  test('blocked → paste page source → card', async ({ page }) => {
    await mockProxy(page, { pages });
    await page.goto('/');
    await tryLink(page, BLOCKED);

    // The message and the ways forward replace the card.
    const banner = page.locator('.banner-blocked');
    await expect(banner).toContainText("didn't let us read this page automatically");
    await expect(page.locator('.editor')).toHaveAttribute('data-blocked', 'true');
    await expect(page.locator('.stage')).toBeHidden();
    await expect(page.locator('#download-btn')).toBeHidden();
    for (const name of ['Use the bookmarklet', 'Paste page source', 'Fill in manually']) {
      await expect(banner.getByRole('button', { name })).toBeVisible();
    }

    await banner.getByRole('button', { name: 'Paste page source' }).click();
    const dialog = page.getByRole('dialog', { name: 'Paste page source' });
    await expect(dialog.getByLabel('Page address')).toHaveValue(BLOCKED);

    // Nothing to submit yet, then the right page (the address is read from the source itself).
    await dialog.getByRole('button', { name: 'Create card' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Paste the page source first.');
    await dialog.getByLabel('Page address').fill('');
    await dialog.getByLabel('Page source', { exact: true }).fill(courierHtml());
    await dialog.getByRole('button', { name: 'Create card' }).click();

    await expect(headline(page)).toHaveText(HEADLINE);
    await settled(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.editor')).toHaveAttribute('data-blocked', 'false');
    await expect(page.locator('.stage-status')).toContainText(
      'Read from the page source you pasted',
    );
    await expect(page.locator('#url-field')).toHaveValue(COURIER);
    await expect(page.locator('#download-btn')).toBeEnabled();
    expect(page.url()).not.toContain('url='); // a pasted card cannot be reloaded from a link
  });

  test('the dialog explains what it needs and keeps what was typed', async ({ page }) => {
    await mockProxy(page, { pages });
    await page.goto('/');
    await page.getByRole('button', { name: 'Paste page source' }).click();
    const dialog = page.getByRole('dialog', { name: 'Paste page source' });
    await dialog.getByLabel('Page source', { exact: true }).fill('just some words');
    await dialog.getByRole('button', { name: 'Create card' }).click();
    await expect(dialog.getByRole('alert')).toContainText('does not look like page source');

    // Source without a canonical link needs an address.
    const bare = courierHtml()
      .replace(/<link rel="canonical"[^>]*>/, '')
      .replace(/<meta property="og:url"[^>]*>/, '');
    await dialog.getByLabel('Page source', { exact: true }).fill(bare);
    await dialog.getByRole('button', { name: 'Create card' }).click();
    await expect(dialog.getByRole('alert')).toContainText('page address');
    await expect(dialog.getByLabel('Page address')).toBeFocused();
    await dialog.getByLabel('Page address').fill(COURIER);
    await dialog.getByRole('button', { name: 'Create card' }).click();
    await expect(headline(page)).toHaveText(HEADLINE);
  });

  test('a saved .html file dropped on the page opens the dialog with it ready', async ({
    page,
  }) => {
    await mockProxy(page, { pages });
    await page.goto('/');
    await page.evaluate((html) => {
      const data = new DataTransfer();
      data.items.add(new File([html], 'saved-page.html', { type: 'text/html' }));
      for (const type of ['dragenter', 'dragover', 'drop']) {
        document.body.dispatchEvent(
          new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }),
        );
      }
    }, courierHtml());

    const dialog = page.getByRole('dialog', { name: 'Paste page source' });
    await expect(dialog.locator('.file-row')).toContainText('saved-page.html');
    await expect(dialog.getByLabel('Page source', { exact: true })).toBeHidden();
    await dialog.getByRole('button', { name: 'Create card' }).click();
    await expect(headline(page)).toHaveText(HEADLINE);
    await settled(page);
  });

  test('a page with no headline offers manual mode, prefilled with what was found', async ({
    page,
  }) => {
    await mockProxy(page, { pages });
    await page.goto('/');
    await tryLink(page, NOTES);
    const banner = page.locator('.banner');
    await expect(banner).toContainText("couldn't find a headline");
    await banner.getByRole('button', { name: 'Fill in manually' }).click();

    const dialog = page.getByRole('dialog', { name: 'Start from scratch' });
    await expect(dialog.getByLabel('Headline')).toHaveValue('My weekend notes');
    await expect(dialog.getByLabel('Link')).toHaveValue(NOTES);
    await dialog.getByLabel('Headline').fill('My weekend notes, edited by hand');
    await dialog.getByRole('button', { name: 'Create card' }).click();
    await expect(headline(page)).toHaveText('My weekend notes, edited by hand');
    await settled(page);
  });
});

test.describe('manual mode', () => {
  test('start from scratch with a registry outlet', async ({ page }) => {
    const mock = await mockProxy(page, { pages });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start from scratch' }).click();
    const dialog = page.getByRole('dialog', { name: 'Start from scratch' });

    await dialog.getByRole('button', { name: 'Create card' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Add a headline.');

    await dialog.getByLabel('Outlet', { exact: true }).selectOption({ label: 'The Guardian' });
    await expect(dialog.getByLabel('Outlet name')).toBeHidden();
    await dialog.getByLabel('Headline').fill('Harbour tram line gets the green light');
    await dialog.getByLabel('Subtitle').fill('Councillors voted 9 to 6 late on Thursday');
    await dialog.getByLabel('Date').fill('2026-11-05');
    await dialog
      .getByLabel('Link')
      .fill('https://www.theguardian.com/world/2026/nov/05/tram?utm_source=x');
    await dialog.getByRole('button', { name: 'Create card' }).click();

    await expect(headline(page)).toHaveText('Harbour tram line gets the green light');
    await settled(page);
    await expect(page.locator('.stage-scaler .nc-deck')).toContainText('Councillors voted 9 to 6');
    await expect(page.locator('.stage-scaler .nc-meta-start')).toContainText('2026');
    await expect(page.locator('.stage-scaler .nc-meta-url')).toContainText('theguardian.com');
    await expect(page.locator('#url-field')).toHaveValue(
      'https://www.theguardian.com/world/2026/nov/05/tram',
    );
    expect(mock.textRequests).toEqual([]); // nothing to read, so nothing was fetched
    expect(page.url()).not.toContain('url=');
  });

  test('without an outlet or a link the card still works, with no address on it', async ({
    page,
  }) => {
    await mockProxy(page, { pages });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start from scratch' }).click();
    const dialog = page.getByRole('dialog', { name: 'Start from scratch' });
    await dialog.getByLabel('Outlet name').fill('Radio Locale');
    await dialog.getByLabel('Headline').fill('Night buses to run every 20 minutes');
    await dialog.getByRole('button', { name: 'Create card' }).click();
    await expect(headline(page)).toHaveText('Night buses to run every 20 minutes');
    await settled(page);
    await expect(page.locator('.stage-scaler .nc-meta-url')).toHaveCount(0);
    await expect(page.locator('.stage-scaler')).toContainText('Radio Locale');
    await expect(page.locator('#download-btn')).toBeEnabled();
  });
});

test.describe('the bookmarklet', () => {
  async function installedCode(page: Page): Promise<string> {
    await page.goto('/');
    await page.getByRole('button', { name: 'Use the bookmarklet' }).click();
    const dialog = page.getByRole('dialog', { name: 'Bookmarklet' });
    await expect(dialog.getByRole('listitem')).toHaveCount(3);
    const link = dialog.locator('a.bookmarklet-link');
    await expect(link).toHaveText('Make news card');
    const href = (await link.getAttribute('href')) ?? '';
    expect(href).toMatch(/^javascript:void\(/);

    // Clicking it here must not run it: it is meant to be dragged to the bookmarks bar.
    await link.click();
    await expect(dialog).toContainText('Drag it to your bookmarks bar');
    expect(page.url()).toBe('http://localhost:4173/');
    return decodeURI(href.slice('javascript:'.length));
  }

  test('runs on an article page and brings its card back to the app', async ({ page }) => {
    const mock = await mockProxy(page, { pages: {} });
    const code = await installedCode(page);

    // The article page, served from a fake origin; the bookmarklet runs in it like a real bookmark would.
    await page.route(`${ORIGIN}/**`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: courierHtml() }),
    );
    await page.goto(COURIER);
    await expect(page).toHaveTitle(/tram/i);
    await page.evaluate(code).catch(() => undefined); // the page is navigated away while this settles

    await expect(headline(page)).toHaveText(HEADLINE);
    await settled(page);
    expect(page.url()).toBe('http://localhost:4173/'); // the payload is gone from the address
    await expect(page.locator('.stage-status')).toContainText(
      'Read from the page you were viewing',
    );
    await expect(page.locator('#url-field')).toHaveValue(COURIER);
    expect(mock.textRequests).toEqual([]); // the page was never fetched
    expect(mock.imageRequests.length).toBeGreaterThan(0); // its images go through the proxy as usual
  });

  test('data that is not valid is explained, and dropped from the address', async ({ page }) => {
    await mockProxy(page, { pages });
    await page.goto('/#bm=this-is-not-a-payload');
    await expect(page.getByRole('alert')).toContainText("bookmarklet's data wasn't valid");
    await expect(page.getByLabel('News article link')).toBeVisible();
    expect(page.url()).toBe('http://localhost:4173/');
  });
});
