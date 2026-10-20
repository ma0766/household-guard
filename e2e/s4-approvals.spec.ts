import { test, expect } from '@playwright/test';
import { freshHouse, signIn, confirmOnPhone } from './helpers.js';

test('S4: teen $38 ride is held → $14 shared ride offered and accepted; Mom approves a $38 ride by number', async ({ page }) => {
  await page.goto(freshHouse());
  await signIn(page, 'maya');
  await page.getByRole('button', { name: 'Book a ride to the airport' }).click();
  const says = page.getByTestId('alexa-says');
  await expect(says).toContainText("Held: over Maya's $20 a week.");
  await expect(says).toContainText('A shared ride for $14 fits.');
  await page.screenshot({ path: 'test-results/s4-held-with-offer.png' });
  // Mom's phone shows who, what, how much, why
  const card = page.getByTestId('approval-mom');
  await expect(card).toContainText('Maya');
  await expect(card).toContainText('$38');
  await page.screenshot({ path: 'test-results/s4-approval-card.png' });
  // accept the shared ride — no adult needed
  await page.getByTestId('accept-alt').click();
  await confirmOnPhone(page, 'maya');
  await expect(says).toHaveText('Your ride is booked. $14 in all.');
  await expect(page.getByTestId('approval-mom')).toHaveCount(0);

  // a second held ride: this time Mom says yes by matching the number Alexa said
  await page.getByRole('button', { name: 'Book a ride to the airport' }).click();
  await expect(says).toContainText('An adult can tap');
  const n = (await says.textContent())!.match(/tap (\d\d) to say yes/)![1];
  await page.getByTestId(`approve-mom-num-${n}`).click();
  await expect(says).toHaveText('Your ride is booked. $38 in all.');
});
