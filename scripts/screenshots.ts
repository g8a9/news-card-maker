// Generates the README pictures in docs/screenshots (PLAN.md M7), with Playwright, from synthetic data
// only: a hand-made fixture page and a generated gradient, never a real article, picture or logo.
//
//   npm run screenshots        # needs Chromium: npx playwright install chromium
//
// It builds the app against the fake proxy address the end-to-end tests use, serves it with `vite
// preview`, answers the proxy requests from fixtures, and drives the real UI.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { fixture, mockProxy, PROXY } from '../web/tests/e2e/helpers.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'docs', 'screenshots');
const PORT = 4175;
const APP = `http://localhost:${PORT}`;
const ARTICLE =
  'https://www.thecourier.test/transport/2026/nov/06/council-approves-harbour-tram-line';

function build(): void {
  const result = spawnSync('npm', ['run', 'build', '-w', 'web'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, VITE_PROXY_URL: PROXY },
  });
  if (result.status !== 0) throw new Error('The build failed');
}

async function serve(): Promise<ChildProcess> {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: join(ROOT, 'web'),
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(APP)).ok) return server;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  server.kill();
  throw new Error('The preview server did not start');
}

async function settled(page: Page): Promise<void> {
  await page.waitForSelector('#app[data-pipeline="done"]');
  await page.waitForSelector('.stage[data-rendering="false"]');
  await page.waitForTimeout(250);
}

/** What the Download button saves: the same PNG a person gets. */
async function exportPng(page: Page): Promise<Buffer> {
  const download = page.waitForEvent('download');
  await page.locator('#download-btn').click();
  await page.getByRole('menuitem', { name: 'PNG' }).click();
  const file = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of file) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  build();
  const server = await serve();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      acceptDownloads: true,
    });
    const page = await context.newPage();
    // The logo and icon requests fail on purpose: the card falls back to the outlet name, and the
    // pictures never show a placeholder where a publisher's logo would be.
    await mockProxy(page, {
      pages: { [ARTICLE]: { body: fixture('courier-like-overlay.html') } },
      image: (url) => (/logo|icon|favicon/i.test(url) ? 'fail' : { w: 1200, h: 630 }),
    });

    await page.goto(APP);
    await page.getByLabel('News article link').focus();
    await page.screenshot({ path: join(OUT, 'landing.png') });

    await page.getByLabel('News article link').fill(ARTICLE);
    await page.keyboard.press('Enter');
    await settled(page);
    await page.screenshot({ path: join(OUT, 'editor.png') });

    // Three cards, exported with the real Download button, side by side.
    const cards: Buffer[] = [];
    cards.push(await exportPng(page));

    await page.getByRole('radio', { name: 'Split' }).click();
    await page.locator('#section-style-head').click();
    await page.getByRole('radio', { name: 'Dark' }).click();
    await settled(page);
    cards.push(await exportPng(page));

    await page.getByRole('radio', { name: 'Headline' }).click();
    await page.getByRole('radio', { name: 'Paper' }).click();
    await settled(page);
    cards.push(await exportPng(page));

    const montage = await context.newPage();
    const images = cards
      .map((png) => `<img src="data:image/png;base64,${png.toString('base64')}" alt="">`)
      .join('');
    await montage.setViewportSize({ width: 1500, height: 560 });
    await montage.setContent(`<!doctype html><meta charset="utf-8"><style>
      html { background: radial-gradient(circle at 20% 0%, #26262b, #0d0d0f 70%); }
      body { margin: 0; padding: 36px; display: flex; gap: 28px; align-items: center; justify-content: center; box-sizing: border-box; min-height: 560px; }
      img { width: 440px; height: auto; border-radius: 10px; box-shadow: 0 18px 40px rgba(0,0,0,.45); }
    </style>${images}`);
    await montage.waitForFunction(() =>
      [...document.images].every((img) => img.complete && img.naturalWidth > 0),
    );
    await montage.screenshot({ path: join(OUT, 'cards.png') });
    writeFileSync(join(OUT, '.gitkeep'), '');
  } finally {
    await browser.close();
    server.kill();
  }
  for (const name of ['landing', 'editor', 'cards']) {
    const size = statSync(join(OUT, `${name}.png`)).size;
    console.log(`docs/screenshots/${name}.png  ${Math.round(size / 1024)} KB`);
  }
}

await main();
