import { expect, test } from '@playwright/test';

test('placeholder page calls the proxy /health', async ({ page }) => {
  await page.route('http://proxy.test/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ ok: true, version: 'test' }),
    }),
  );
  await page.goto('/');
  await expect(page.locator('#proxy-status')).toHaveText('Proxy: ok (test)');
});
