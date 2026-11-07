import { expect, test } from '@playwright/test';

// The dev gallery renders every template × theme × size with the real renderer and fitter (M3).
interface Report {
  id: string;
  fixture: string;
  template: string;
  theme: string;
  size: string;
  width: number;
  height: number;
  fit: { overflow: boolean; hidden: string[]; headlineU: number };
  escapes: string[];
}
type GalleryWindow = Window & { __gallery: { ready: Promise<Report[]> } };

test.describe('dev gallery', () => {
  test('every template × theme × size renders without overflow', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto('/dev/gallery.html');
    const reports = await page.evaluate(() => (window as unknown as GalleryWindow).__gallery.ready);

    // 3 templates × 5 themes × 9 sizes for the standard fixture, plus the edge-case fixtures.
    const matrix = reports.filter((r) => r.fixture === 'standard');
    expect(matrix).toHaveLength(3 * 5 * 9);
    expect(new Set(matrix.map((r) => r.template))).toEqual(
      new Set(['classic', 'split', 'headline']),
    );
    expect(new Set(matrix.map((r) => r.theme))).toEqual(
      new Set(['light', 'dark', 'brand', 'paper', 'mono']),
    );
    expect(new Set(matrix.map((r) => r.size)).size).toBe(9);
    expect(reports.length).toBeGreaterThan(300);

    const problems = reports
      .filter((r) => r.escapes.length > 0 || r.fit.overflow)
      .map((r) => `${r.id}: ${r.escapes.join(',')}`);
    expect(problems).toEqual([]);

    // Fixed sizes come out at exactly the documented logical size.
    const sizes: Record<string, [number, number]> = {
      '16:9': [1200, 675],
      '4:3': [1200, 900],
      '3:2': [1200, 800],
      '1.91:1': [1200, 628],
      '2:1': [1200, 600],
      '1:1': [1080, 1080],
      '4:5': [1080, 1350],
      '9:16': [1080, 1920],
    };
    for (const r of reports) {
      const expected = sizes[r.size];
      if (expected) expect([r.width, r.height], r.id).toEqual(expected);
      else expect(r.width, r.id).toBe(1200);
    }
  });

  test('right-to-left cards mirror their layout', async ({ page }) => {
    await page.goto('/dev/gallery.html?fixture=arabic&template=classic&theme=light&size=16:9');
    await page.evaluate(() => (window as unknown as GalleryWindow).__gallery.ready);
    const card = page.locator('.nc-card');
    await expect(card).toHaveAttribute('dir', 'rtl');
    await expect(card).toHaveAttribute('lang', 'ar');

    const geometry = await page.evaluate(() => {
      const box = (el: Element | null) => (el as HTMLElement).getBoundingClientRect();
      const cardBox = box(document.querySelector('.nc-card'));
      const icon = box(document.querySelector('.nc-masthead .nc-logo'));
      const name = box(document.querySelector('.nc-site'));
      const headline = document.querySelector('.nc-headline') as HTMLElement;
      const range = document.createRange();
      range.selectNodeContents(headline);
      const lines = [...range.getClientRects()];
      const url = box(document.querySelector('.nc-meta-url'));
      const date = box(document.querySelector('.nc-meta-start'));
      return {
        card: { left: cardBox.left, right: cardBox.right, width: cardBox.width },
        icon: { left: icon.left, right: icon.right },
        name: { right: name.right },
        firstLineRight: Math.max(...lines.map((l) => l.right)),
        headlineRight: box(headline).right,
        urlLeft: url.left,
        dateRight: date.right,
        direction: getComputedStyle(headline).direction,
      };
    });
    const centre = geometry.card.left + geometry.card.width / 2;
    expect(geometry.direction).toBe('rtl');
    expect(geometry.icon.left).toBeGreaterThan(centre); // the masthead starts on the right
    expect(geometry.name.right).toBeLessThanOrEqual(geometry.icon.left + 1); // and the name follows it leftwards
    expect(geometry.headlineRight - geometry.firstLineRight).toBeLessThan(6); // headline is right-aligned
    expect(geometry.dateRight).toBeGreaterThan(centre); // date on the start (right) side
    expect(geometry.urlLeft).toBeLessThan(centre); // URL on the end (left) side
  });

  test('CJK and Hebrew cards use strict line breaking and fit', async ({ page }) => {
    await page.goto('/dev/gallery.html?fixture=cjk&template=classic&theme=light&size=auto');
    await page.evaluate(() => (window as unknown as GalleryWindow).__gallery.ready);
    const lineBreak = await page
      .locator('.nc-card')
      .evaluate((el) => getComputedStyle(el).lineBreak);
    expect(lineBreak).toBe('strict');
    const headline = page.locator('.nc-headline');
    await expect(headline).toContainText('国産ロボット掃除機');
    const fits = await headline.evaluate(
      (el) => el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().height > 0,
    );
    expect(fits).toBe(true);

    await page.goto('/dev/gallery.html?fixture=hebrew&template=split&theme=dark&size=16:9');
    await page.evaluate(() => (window as unknown as GalleryWindow).__gallery.ready);
    await expect(page.locator('.nc-card')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('.nc-headline')).toContainText('הממשלה אישרה');
  });

  test('long German compounds break instead of overflowing', async ({ page }) => {
    await page.goto('/dev/gallery.html?fixture=german&template=headline&theme=light&size=1:1');
    const reports = await page.evaluate(() => (window as unknown as GalleryWindow).__gallery.ready);
    expect(reports[0]?.escapes).toEqual([]);
    const wide = await page
      .locator('.nc-headline')
      .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(wide).toBe(false);
  });

  test('a frame widens the export target and keeps the card inside it', async ({ page }) => {
    await page.goto(
      '/dev/gallery.html?fixture=standard&template=classic&theme=light&size=16:9&frame=1',
    );
    await page.evaluate(() => (window as unknown as GalleryWindow).__gallery.ready);
    const sizes = await page.evaluate(() => {
      const frame = document.querySelector('.nc-frame') as HTMLElement;
      const card = document.querySelector('.nc-card') as HTMLElement;
      return {
        frame: [frame.offsetWidth, frame.offsetHeight],
        card: [card.offsetWidth, card.offsetHeight],
      };
    });
    expect(sizes.card).toEqual([1200, 675]);
    expect(sizes.frame).toEqual([1200 + 2 * 6 * 12, 675 + 2 * 6 * 12]);
  });
});
