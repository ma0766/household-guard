import { test, expect } from '@playwright/test';
import { freshHouse, signIn, confirmOnPhone } from './helpers.js';

test('S15: "Build a site for my bakery" is a job: Mom taps, it is built and published, and the preview shows with a code to scan', async ({ page, browser }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');
  await signIn(page, 'mom');
  await page.getByTestId('btn-build-site').click();
  await confirmOnPhone(page, 'mom');
  await expect(says).toHaveText('Your site is ready. Sunny Bakery.', { timeout: 20000 });
  const frame = page.frameLocator('[data-testid=app-frame]');
  await expect(frame.getByTestId('app-qr')).toBeVisible();
  const link = (await frame.getByTestId('app-link').textContent())!;
  expect(link).toMatch(/\/preview\/[A-Za-z0-9_-]{16,}$/);
  await page.screenshot({ path: 'test-results/s15-site-ready.png' });
  const site = await (await browser.newContext({ viewport: { width: 390, height: 700 } })).newPage();
  await site.goto(link);
  await expect(site.getByRole('heading', { name: 'Sunny Bakery' })).toBeVisible();
  await site.screenshot({ path: 'test-results/s15-site-preview.png' });

  // a teen asking for the same is held: nothing is built
  await signIn(page, 'maya');
  await page.getByTestId('btn-build-site').click();
  await expect(says).toContainText('An adult must say yes');
});
