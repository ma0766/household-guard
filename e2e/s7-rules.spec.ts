import { test, expect } from '@playwright/test';
import { freshHouse, signIn, confirmOnPhone } from './helpers.js';

test('S7: Mom changes Maya\'s limit from the card; the next ride follows it; a teen cannot', async ({ page }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');
  const rules = page.frameLocator('[data-testid="rules-frame"]');

  await signIn(page, 'mom');
  await expect(rules.getByText('Maya: $20 a week.')).toBeVisible();
  await page.getByTestId('rule-maya-limit').fill('40');
  await page.getByTestId('rule-save-maya').click();
  await confirmOnPhone(page, 'mom');
  await expect(says).toHaveText("Maya's limit goes from $20 to $40 a week.");
  await expect(rules.getByText('Maya: $40 a week.')).toBeVisible();
  await page.screenshot({ path: 'test-results/s7-rule-card.png' });

  // the next decision follows it: the $38 ride is now fine for Maya
  await signIn(page, 'maya');
  await page.getByRole('button', { name: 'Book a ride to the airport' }).click();
  await expect(says).toContainText('Confirm on your phone:');

  // a teen cannot change a rule
  await page.getByTestId('rule-maya-limit').fill('500');
  await page.getByTestId('rule-save-maya').click();
  await expect(says).toHaveText('Only adults can change rules.');
});

test('S7: undo restores the old limit', async ({ page }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');
  const rules = page.frameLocator('[data-testid="rules-frame"]');
  await signIn(page, 'mom');
  await page.getByTestId('rule-maya-limit').fill('40');
  await page.getByTestId('rule-save-maya').click();
  await confirmOnPhone(page, 'mom');
  await expect(rules.getByText('Maya: $40 a week.')).toBeVisible();
  await page.getByTestId('rule-undo').click(); // one more tap on Mom's own phone
  await confirmOnPhone(page, 'mom');
  await expect(says).toContainText('Undone:');
  await expect(rules.getByText('Maya: $20 a week.')).toBeVisible();
});
