import { test, expect } from '@playwright/test';
import { freshHouse, signIn, confirmOnPhone } from './helpers.js';

test('S11: a broken ride service is repaired, and the next ride needs one approval', async ({ page }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');
  const status = page.getByTestId('conn-status');
  await signIn(page, 'mom'); // only a confirmed adult can break the shared service
  await page.getByTestId('btn-break-ride').click();
  await expect(says).toContainText('shipped a new version');
  await signIn(page, 'maya');

  // the service ships a new version (price → fare_cents): a ride is held, never guessed
  await page.getByRole('button', { name: 'Book a ride to the mall' }).click();
  await expect(says).toContainText('That service is not working. An adult was told.');
  await page.screenshot({ path: 'test-results/s11-broken.png' });

  // the health check finds it, a repair is proposed, tested, and used
  await page.getByTestId('btn-check-rides').click();
  await expect(says).toContainText('We fixed it.');
  await expect(status).toHaveText('Fixed. The next ride needs a yes.');
  await page.screenshot({ path: 'test-results/s11-repaired.png' });

  // the next ride, even $15 inside her limit, waits for ONE yes from an adult
  await page.getByRole('button', { name: 'Book a ride to the mall' }).click();
  await expect(says).toContainText('Held: this service was just fixed. An adult must say yes once.');
  const n = (await says.textContent())!.match(/tap (\d\d) to say yes/)![1];
  await page.getByTestId(`approve-mom-num-${n}`).click();
  await expect(says).toHaveText('Your ride is booked. $15 in all.');
  await expect(status).toHaveText('The ride service works.');
  await page.screenshot({ path: 'test-results/s11-approved.png' });

  // after that one yes, rides go the normal way again
  await signIn(page, 'mom');
  await page.getByRole('button', { name: 'Book a ride to the mall' }).click();
  await confirmOnPhone(page, 'mom');
  await expect(says).toHaveText('Your ride is booked. $15 in all.');
});
