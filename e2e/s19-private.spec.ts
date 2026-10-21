import { test, expect } from '@playwright/test';
import { freshHouse, signIn, confirmOnPhone } from './helpers.js';

// S19: Leo (8, PIN) asks what Mom ordered. He gets a short plain answer and no item names appear anywhere on the page.
const ITEMS = /lego|castle|soccer|paper towels|charger/i;

test('S19: Leo asks "what did Mom order?" and hears it is private; Mom hears the list', async ({ page }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');

  await page.getByTestId('who-leo').click();
  await page.getByTestId('pin').fill('4821');
  await page.getByTestId('btn-pin').click();
  await expect(says).toHaveText('Hi Leo.');

  await page.getByTestId('say').fill('what did Mom order?');
  await page.getByTestId('btn-say').click();
  await expect(says).toHaveText("That's private. Ask a grown-up.");
  await expect(says).toHaveAttribute('data-outcome', 'denied');

  // the timeline says Leo asked; it never says what
  const timeline = page.frameLocator('[data-testid=timeline]').locator('body');
  await expect(timeline).toContainText('Leo asked to hear about orders', { timeout: 10000 });
  await page.waitForTimeout(2500); // let every refresh run
  expect(await page.locator('body').innerText()).not.toMatch(ITEMS);
  expect(await timeline.innerText()).not.toMatch(ITEMS);
  await page.screenshot({ path: 'test-results/s19-leo-private.png', fullPage: true });

  // Mom asks the same question and hears the list, gift included
  await signIn(page, 'mom');
  await page.getByTestId('say').fill('what did Mom order?');
  await page.getByTestId('btn-say').click();
  await expect(says).toContainText('Lego castle');
  await expect(says).toContainText('a gift for Leo');
  await expect(timeline).not.toContainText(/lego|castle/i);
  await page.screenshot({ path: 'test-results/s19-mom-hears.png', fullPage: true });
});

test('S19: Mom opens orders to teens from the rule card; Maya still never hears the gift', async ({ page }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');
  await signIn(page, 'mom');
  await page.getByTestId('rule-orders-teens').click();
  await confirmOnPhone(page, 'mom');
  await expect(says).toHaveText('Adults and teens hear orders. Gifts stay private.');
  await signIn(page, 'maya');
  await page.getByTestId('say').fill('what did Mom order?');
  await page.getByTestId('btn-say').click();
  await expect(says).toContainText('paper towels');
  await expect(says).not.toContainText(/lego|castle/i);
  await expect(says).toContainText('Some are private.');
});
