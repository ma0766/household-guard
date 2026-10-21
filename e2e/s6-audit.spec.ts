import { test, expect } from '@playwright/test';
import { freshHouse, signIn, confirmOnPhone } from './helpers.js';

test('S6: $38 ride held → $14 shared ride offered and accepted → the $24 saving is in the timeline, in plain words', async ({ page }) => {
  await page.goto(freshHouse());
  await signIn(page, 'maya');
  await page.getByRole('button', { name: 'Book a ride to the airport' }).click();
  const says = page.getByTestId('alexa-says');
  await expect(says).toContainText("Held: over Maya's $20 a week.");
  await expect(says).toContainText('A shared ride for $14 fits.');
  await page.getByTestId('accept-alt').click();
  await confirmOnPhone(page, 'maya');
  await expect(says).toHaveText('Your ride is booked. $14 in all.');

  const frame = page.frameLocator('[data-testid="timeline"]');
  await expect(frame.getByText("Maya asked for a $38 ride", { exact: false })).toBeVisible();
  await expect(frame.getByText("Held: over Maya's $20 a week.", { exact: false })).toBeVisible();
  await expect(frame.getByText('Maya took a shared ride for $14, not $38. Saved $24.')).toBeVisible();
  await expect(frame.getByText('Ride booked for Maya: $14', { exact: false })).toBeVisible();
  await page.screenshot({ path: 'test-results/s6-timeline-saving.png' });

  // Mom looks at the whole house (kids only see their own things)
  await signIn(page, 'mom');
  await expect(frame.getByText('Maya took a shared ride for $14, not $38. Saved $24.')).toBeVisible();
  // filter by person: Mom did nothing
  await page.getByTestId('tl-person').selectOption('mom');
  await expect(frame.getByText('Maya took a shared ride')).toHaveCount(0);
  await page.getByTestId('tl-person').selectOption('');

  // by voice: totals first
  await page.getByTestId('btn-kids-week').click();
  await expect(page.getByTestId('summary')).toHaveText("The kids spent $14 this week. That is 1 buy. The last was Maya's, $14. You saved $24.");
});
