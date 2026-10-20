import { test, expect } from '@playwright/test';
import { freshHouse, confirmOnPhone } from './helpers.js';

test('S2: a name alone does nothing; the number lands on the right phone; PIN works; 4th push locks', async ({ page }) => {
  await page.goto(freshHouse());
  // guest says "unlock" → denied
  await page.getByTestId('who-guest').click();
  await page.getByRole('button', { name: 'Unlock the front door' }).click();
  await expect(page.getByTestId('alexa-says')).toHaveText('Tell me who you are first.');
  // Mom's turn: the number appears on Mom's phone only
  await page.getByTestId('who-mom').click();
  await expect(page.getByTestId('phone-mom').locator('button')).toHaveCount(3);
  await expect(page.getByTestId('phone-maya').locator('button')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/s2-number-match.png' });
  await confirmOnPhone(page, 'mom');
  await expect(page.getByTestId('alexa-says')).toContainText('Mom is confirmed');
  // Leo uses a PIN
  await page.getByTestId('who-leo').click();
  await page.getByTestId('pin').fill('0000');
  await page.getByTestId('btn-pin').click();
  await expect(page.getByTestId('alexa-says')).toHaveText('That PIN is not right.');
  await page.getByTestId('pin').fill('4821');
  await page.getByTestId('btn-pin').click();
  await expect(page.getByTestId('alexa-says')).toHaveText('Hi Leo.');
  // Maya asks 4 times → locked
  for (let i = 0; i < 3; i++) await page.getByTestId('who-maya').click();
  await page.getByTestId('who-maya').click();
  await expect(page.getByTestId('alexa-says')).toHaveText('Too many tries. Locked for 10 minutes.');
});
