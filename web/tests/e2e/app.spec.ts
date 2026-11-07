import { expect, type Page, test } from '@playwright/test';
import { fixture, mockProxy, png } from './helpers.ts';

const COURIER =
  'https://www.thecourier.test/transport/2026/nov/06/council-approves-harbour-tram-line';
const KURIER = 'https://www.derkurier.test/wirtschaft/hafen-ausbau-a-123.html';
const HEADLINE = 'Council approves harbour tram line after late vote';

const pages = {
  [COURIER]: { body: fixture('courier-like-overlay.html') },
  [KURIER]: { body: fixture('kurier-like-three-titles.html') },
};

/** Waits until the pipeline has finished and the stage has caught up with the state. */
async function settled(page: Page) {
  await expect(page.locator('#app')).toHaveAttribute('data-pipeline', 'done');
  await expect(page.locator('.stage')).toHaveAttribute('data-rendering', 'false');
}

async function open(page: Page, url = COURIER) {
  await mockProxy(page, { pages });
  await page.goto('/');
  await page.getByLabel('News article link').fill(url);
  await page.keyboard.press('Enter');
  await expect(page.locator('.stage-scaler .nc-headline')).toBeVisible();
  await settled(page);
}

const panelSwitch = (page: Page, name: string) => page.getByRole('switch', { name });

test.describe('landing', () => {
  test('is a single focused text box with examples and escape hatches', async ({ page }) => {
    await mockProxy(page, { pages });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'News Card Maker' })).toBeVisible();
    await expect(page.getByLabel('News article link')).toBeFocused();
    await expect(page.getByRole('button', { name: /Create/ })).toBeDisabled();
    await expect(page.locator('.chip')).toHaveCount(3);
    for (const name of ['Use the bookmarklet', 'Paste page source', 'Start from scratch']) {
      await expect(page.getByRole('button', { name })).toBeVisible();
    }
    await page.getByLabel('News article link').fill('https://example.com/story');
    await expect(page.getByRole('button', { name: /Create/ })).toBeEnabled();
  });

  test('shows an inline message for input that is not a link', async ({ page }) => {
    await mockProxy(page, { pages });
    await page.goto('/');
    await page.getByLabel('News article link').fill('hello there');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toHaveText('Paste a full link, starting with https://');
    await expect(page.locator('.editor')).toBeHidden();
  });

  test('explains when the fetch service is down', async ({ page }) => {
    await mockProxy(page, { pages: { [COURIER]: 'abort' } });
    await page.goto('/');
    await page.getByLabel('News article link').fill(COURIER);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toContainText('The fetch service is unavailable');
    await expect(page.getByLabel('News article link')).toHaveValue(COURIER);
  });

  test('pasting a link anywhere on the page creates the card', async ({ page, browserName }) => {
    test.skip(
      browserName === 'firefox',
      'Firefox ignores clipboardData on synthetic paste events; real pastes work',
    );
    await mockProxy(page, { pages });
    await page.goto('/');
    await page.locator('body').click();
    await page.evaluate((text) => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      document.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, `Council approves tram line — ${COURIER} (via a friend)`);
    await expect(page.locator('.stage-scaler .nc-headline')).toHaveText(HEADLINE);
  });
});

test.describe('creating a card', () => {
  test('landing → link → card, filling in progressively', async ({ page }) => {
    await open(page);
    await expect(page.locator('.stage-scaler .nc-headline')).toHaveText(HEADLINE);
    await expect(
      page.locator('.stage-scaler .nc-site, .stage-scaler .nc-logo-wordmark').first(),
    ).toBeVisible();
    await expect(page.locator('.stage-scaler .nc-meta-start')).toContainText('Nov 6, 2026');
    await expect(page.locator('.stage-scaler .nc-media img')).toBeVisible(); // the image arrives after the text
    await expect(page.locator('#px-readout')).toContainText('px');
    await expect(page).toHaveURL(/\?url=/);
  });

  test('?url= loads the card on arrival', async ({ page }) => {
    await mockProxy(page, { pages });
    await page.goto(`/?url=${encodeURIComponent(COURIER)}`);
    await expect(page.locator('.stage-scaler .nc-headline')).toHaveText(HEADLINE);
    await page.reload();
    await expect(page.locator('.stage-scaler .nc-headline')).toHaveText(HEADLINE);
  });

  test('an example chip runs the normal pipeline', async ({ page }) => {
    const target = 'https://www.404media.co/behind-the-blog-dams-bursting/';
    await mockProxy(page, {
      pages: { [target]: { body: fixture('wired-like-junk-section.html') } },
    });
    await page.goto('/');
    await page.getByRole('button', { name: '404 Media' }).click();
    await expect(page.locator('.stage-scaler .nc-headline')).toHaveText(
      'Phone Maker Bets on Repairable Design',
    );
  });

  test('Hacker News items come from the API with the outlet defaults', async ({ page }) => {
    await mockProxy(page, { pages: {} });
    await page.route('https://hacker-news.firebaseio.com/v0/item/4242.json', (route) =>
      route.fulfill({
        headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 4242,
          type: 'story',
          by: 'dhouston',
          time: 1794000000,
          title: 'Show HN: A tiny static site generator',
          url: 'https://example.test/ssg',
          score: 412,
          descendants: 113,
        }),
      }),
    );
    await page.goto('/');
    await page.getByLabel('News article link').fill('https://news.ycombinator.com/item?id=4242');
    await page.keyboard.press('Enter');
    await expect(page.locator('.stage-scaler .nc-headline')).toHaveText(
      'A tiny static site generator',
    );
    await expect(page.locator('.stage-scaler .nc-meta-start')).toContainText(
      '412 points · 113 comments',
    );
    await expect(page.locator('.stage-scaler .nc-card')).toHaveClass(/nc-theme-brand/);
    await expect(page.locator('.stage-scaler .nc-card')).toHaveClass(/nc-t-headline/);
  });

  test('a comment on Hacker News is explained', async ({ page }) => {
    await mockProxy(page, { pages: {} });
    await page.route('https://hacker-news.firebaseio.com/v0/item/9.json', (route) =>
      route.fulfill({
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ id: 9, type: 'comment', parent: 4242 }),
      }),
    );
    await page.goto('/');
    await page.getByLabel('News article link').fill('https://news.ycombinator.com/item?id=9');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toContainText(
      'This is a comment, open its story instead',
    );
  });
});

test.describe('customising', () => {
  test('toggles, template, size and theme change the card', async ({ page }) => {
    await open(page);
    await expect(page.locator('.stage-scaler .nc-deck')).toBeVisible();
    await panelSwitch(page, 'Show subtitle').click();
    await expect(page.locator('.stage-scaler .nc-deck')).toHaveCount(0);
    await panelSwitch(page, 'Show subtitle').click();
    await expect(page.locator('.stage-scaler .nc-deck')).toBeVisible();

    await expect(page.locator('.stage-scaler .nc-kicker')).toHaveCount(0);
    await panelSwitch(page, 'Show kicker').click();
    await expect(page.locator('.stage-scaler .nc-kicker')).toHaveText('Transport');

    await page.getByRole('radio', { name: 'Split' }).click();
    await expect(page.locator('.stage-scaler .nc-card')).toHaveClass(/nc-t-split/);
    await page.getByRole('radio', { name: 'Headline' }).click();
    await expect(page.locator('.stage-scaler .nc-card')).toHaveClass(/nc-t-headline/);
    await page.getByRole('radio', { name: 'Classic' }).click();

    await page.getByLabel('Size', { exact: true }).selectOption('16:9');
    await expect(page.locator('.stage-scaler .nc-card')).toHaveClass(/nc-fixed/);
    await expect(page.locator('#px-readout')).toHaveText('2400 × 1350 px');
    await page.locator('#section-export-head').click(); // the Export section starts closed
    await page.getByRole('radio', { name: '3×' }).click();
    await expect(page.locator('#px-readout')).toHaveText('3600 × 2025 px');

    await page.locator('#section-style-head').click(); // the Style section starts closed
    await page.getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('.stage-scaler .nc-card')).toHaveClass(/nc-theme-dark/);
    await expect(page.locator('.stage-scaler .nc-card')).toHaveCSS(
      'background-color',
      'rgb(18, 18, 20)',
    );
  });

  test('editing the headline updates the card, and reset brings the page value back', async ({
    page,
  }) => {
    await open(page);
    const field = page.getByLabel('Headline', { exact: true });
    await field.fill('My own headline');
    await expect(page.locator('.stage-scaler .nc-headline')).toHaveText('My own headline');
    await page
      .getByRole('button', { name: 'Reset to the value found on the page' })
      .first()
      .click();
    await expect(page.locator('.stage-scaler .nc-headline')).toHaveText(HEADLINE);
    await expect(field).toHaveValue(HEADLINE);
  });

  test('the alternatives menu offers the other headlines, labelled by source', async ({ page }) => {
    await open(page, KURIER);
    await expect(page.locator('.stage-scaler .nc-headline')).toHaveText(
      'Hafenausbau: Teure Kaimauer, unklare Finanzierung',
    );
    const menu = page.getByLabel('Headline: alternatives');
    await expect(menu).toBeVisible();
    await expect(menu.locator('option')).toContainText([
      /Alternatives/,
      /Social title: Wer zahlt/,
      /Page headline: Hafenausbau: Wer zahlt/,
    ]);
    await menu.selectOption({ label: /Social title/ as unknown as string }).catch(async () => {
      const value = await menu.locator('option', { hasText: 'Social title' }).getAttribute('value');
      await menu.selectOption(value as string);
    });
    await expect(page.locator('.stage-scaler .nc-headline')).toHaveText(
      'Wer zahlt für die neue Kaimauer?',
    );
  });

  test('an uploaded image replaces the featured image', async ({ page }) => {
    await open(page);
    await expect(page.locator('.stage-scaler .nc-media img')).toBeVisible();
    const before = await page.locator('.stage-scaler .nc-media img').getAttribute('src');
    await page.locator('[data-field-id="image"] input[type="file"]').setInputFiles({
      name: 'mine.png',
      mimeType: 'image/png',
      buffer: png(800, 800, [200, 40, 40], [40, 40, 200]),
    });
    await expect
      .poll(async () => page.locator('.stage-scaler .nc-media img').getAttribute('src'))
      .not.toBe(before);
    await expect(page.locator('[data-field-id="image"] .thumb[aria-selected="true"]')).toHaveCount(
      1,
    );
  });

  test('dragging the picture moves its focal point', async ({ page }) => {
    await open(page);
    const media = page.locator('.stage-scaler .nc-media');
    await expect(media).toBeVisible();
    // Fonts that arrive late make the stage render the card again, which swaps the element for a new
    // one; ask for its box until there is one, instead of assuming the first answer is a box.
    let measured: { x: number; y: number; width: number; height: number } | null = null;
    await expect
      .poll(async () => {
        measured = await media.boundingBox();
        return measured !== null;
      })
      .toBe(true);
    const box = measured as unknown as { x: number; y: number; width: number; height: number };
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(async () =>
        page
          .locator('.nc-media img')
          .evaluate((el) => (el as HTMLElement).style.getPropertyValue('--fx')),
      )
      .not.toBe('50%');
  });

  test('clicking text on the card jumps to its field', async ({ page }) => {
    await open(page);
    await page.locator('.stage-scaler .nc-headline').click();
    await expect(page.getByLabel('Headline', { exact: true })).toBeFocused();
  });

  test('dropping an image on the preview uses it', async ({ page }) => {
    await open(page);
    const before = await page.locator('.stage-scaler .nc-media img').getAttribute('src');
    const data = png(640, 640, [10, 200, 120], [250, 250, 20]).toString('base64');
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }));
      const stage = document.querySelector('.stage') as HTMLElement;
      stage.dispatchEvent(
        new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }),
      );
      stage.dispatchEvent(
        new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }),
      );
    }, data);
    await expect
      .poll(async () => page.locator('.stage-scaler .nc-media img').getAttribute('src'))
      .not.toBe(before);
  });
});

test.describe('keyboard', () => {
  test('/ focuses the link field, ? opens help, Esc closes it', async ({ page }) => {
    await open(page);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('/');
    await expect(page.locator('#url-field')).toBeFocused();
    await page.keyboard.press('Escape');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('the whole editor works without a mouse', async ({ page }) => {
    await open(page);
    // Move through the panel with Tab, flip a switch with Space and a segmented control with arrows.
    const subtitle = panelSwitch(page, 'Show subtitle');
    await subtitle.focus();
    await page.keyboard.press('Space');
    await expect(page.locator('.stage-scaler .nc-deck')).toHaveCount(0);
    await page.keyboard.press('Space');
    await expect(page.locator('.stage-scaler .nc-deck')).toBeVisible();

    await page.getByRole('radio', { name: 'Classic' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.stage-scaler .nc-card')).toHaveClass(/nc-t-split/);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.stage-scaler .nc-card')).toHaveClass(/nc-t-headline/);

    // Every interactive control has an accessible name.
    const unnamed = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '.editor button, .editor input, .editor select, .editor textarea',
        ),
      ]
        .filter(
          (el) =>
            !el.hidden && !el.closest('[hidden]') && !(el as HTMLInputElement).type?.match(/file/),
        )
        .filter((el) => {
          const labelled =
            el.getAttribute('aria-label') ||
            el.getAttribute('aria-labelledby') ||
            (el as HTMLInputElement).labels?.length ||
            el.textContent?.trim() ||
            el.getAttribute('title');
          return !labelled;
        })
        .map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(unnamed).toEqual([]);
  });

  test('Tab order visits the top bar, the action bar and the panel', async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName === 'webkit',
      'Safari does not tab to buttons unless the user turns that preference on',
    );
    await open(page);
    await page.locator('#url-field').focus();
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el
          ? `${el.tagName}:${el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 24) || el.id}`
          : '';
      });
      seen.add(id);
    }
    expect([...seen].join(' | ')).toContain('Keyboard shortcuts');
    expect([...seen].join(' | ')).toMatch(/Copy image|Download/);
    expect([...seen].join(' | ')).toContain('TEXTAREA');
  });
});

test.describe('responsive', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('on a phone the stage sits above a tabbed panel and the actions stay in reach', async ({
    page,
  }) => {
    await open(page);
    const stage = await page.locator('.stage-area').boundingBox();
    const panel = await page.locator('.panel').boundingBox();
    expect(stage && panel && stage.y < panel.y).toBe(true);
    await expect(page.getByRole('tablist', { name: 'Settings sections' })).toBeVisible();
    await page.getByRole('tab', { name: 'Style' }).click();
    await expect(page.getByRole('radio', { name: 'Dark' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Split' })).toBeHidden();
    const horizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(horizontalScroll).toBe(false);
  });
});
