// The built app ships a Content-Security-Policy <meta> tag (PLAN.md §12.6). It has to be strict enough
// to matter and loose enough that every feature still works, so this runs the features under it.
import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { fixture, openCard } from './helpers.ts';

const COURIER =
  'https://www.thecourier.test/transport/2026/nov/06/council-approves-harbour-tram-line';
const pages = { [COURIER]: { body: fixture('courier-like-overlay.html') } };

const violations = (page: Page) =>
  page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);

test('the app declares its policy and every feature works under it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = seen;
    document.addEventListener('securitypolicyviolation', (e) =>
      seen.push(`${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  const logged: string[] = [];
  page.on('console', (m) => {
    if (/content.security.policy/i.test(m.text())) logged.push(m.text());
  });

  await openCard(page, COURIER, pages);

  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(policy).toContain("script-src 'self'");
  expect(policy).toContain('connect-src');
  expect(policy).toContain('http://proxy.test');

  // Exports rasterise the card through SVG, fonts and images: the part most likely to need a looser policy.
  for (const format of ['PNG', 'JPEG']) {
    const waiting = page.waitForEvent('download');
    await page.locator('#download-btn').click();
    await page.getByRole('menuitem', { name: format }).click();
    const file = await waiting;
    const bytes = readFileSync((await file.path()) as string);
    expect(bytes.length).toBeGreaterThan(10_000);
  }
  if (await page.locator('#copy-btn').count()) {
    await page.locator('#copy-btn').click();
    await expect(
      page.locator('.toast-success:has-text("Copied"), dialog[open]').first(),
    ).toBeVisible();
    if (await page.locator('dialog[open]').count()) await page.keyboard.press('Escape');
  }

  // The dialogs, the panel and a re-render with another template.
  for (const name of ['Bookmarklet', 'Keyboard shortcuts']) {
    await page.getByRole('button', { name }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await page
    .getByRole('radio', { name: /Headline/ })
    .first()
    .click();
  await expect(page.locator('.stage')).toHaveAttribute('data-rendering', 'false');

  expect(await violations(page)).toEqual([]);
  expect(logged).toEqual([]);
});

test('the policy is really enforced: inline scripts and other hosts are refused', async ({
  page,
}) => {
  await openCard(page, COURIER, pages);
  await page.addInitScript(() => undefined);
  const result = await page.evaluate(async () => {
    const seen: string[] = [];
    document.addEventListener('securitypolicyviolation', (e) => seen.push(e.violatedDirective));
    const script = document.createElement('script');
    script.textContent = 'window.__inlineRan = true';
    document.head.append(script);
    let fetched = true;
    try {
      await fetch('https://tracker.example/collect', { mode: 'no-cors' });
    } catch {
      fetched = false;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    return {
      inlineRan: Boolean((window as unknown as { __inlineRan?: boolean }).__inlineRan),
      fetched,
      seen,
    };
  });
  expect(result.inlineRan).toBe(false);
  expect(result.fetched).toBe(false);
  expect(result.seen.some((d) => d.startsWith('script-src'))).toBe(true);
  expect(result.seen.some((d) => d.startsWith('connect-src'))).toBe(true);
});
