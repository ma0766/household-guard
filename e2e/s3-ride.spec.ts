import { test, expect } from '@playwright/test';
import { freshHouse, signIn, confirmOnPhone } from './helpers.js';

test('S3: teen books a $15 ride after her own phone tap; the $38 ride is held', async ({ page }) => {
  await page.goto(freshHouse());
  await signIn(page, 'maya');
  await page.getByRole('button', { name: 'Book a ride to the mall' }).click();
  await confirmOnPhone(page, 'maya');
  await expect(page.getByTestId('alexa-says')).toHaveText('Your ride is booked. $15 in all.');
  await page.screenshot({ path: 'test-results/s3-ride-booked.png' });
  await page.getByRole('button', { name: 'Book a ride to the airport' }).click();
  await expect(page.getByTestId('alexa-says')).toContainText("Held: over Maya's $20 a week.");
});
