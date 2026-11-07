import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
export const PAGES_PORT = 4174;
export const PAGES_BASE = '/news-card-maker/';

export default defineConfig({
  testDir: './tests/e2e',
  // Visual baselines are per platform and browser: fonts and text rendering differ between systems.
  snapshotPathTemplate: '{testDir}/__snapshots__/{platform}/{projectName}/{arg}{ext}',
  expect: { toMatchSnapshot: { maxDiffPixelRatio: 0.005 } },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  // The app is built against a fake proxy origin; tests intercept it with page.route().
  webServer: [
    {
      command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
      port: PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { VITE_E2E: '1', VITE_PROXY_URL: 'http://proxy.test' },
    },
    {
      // The shape of the real deployment: a GitHub Pages project site lives under /<repository>/.
      command: `node ../scripts/build-bookmarklet.ts && vite build --base ${PAGES_BASE} --outDir dist-pages --emptyOutDir && vite preview --base ${PAGES_BASE} --outDir dist-pages --port ${PAGES_PORT} --strictPort`,
      port: PAGES_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        VITE_PROXY_URL: 'http://proxy.test',
        VITE_REPO_URL: 'https://github.com/example/news-card-maker',
      },
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
