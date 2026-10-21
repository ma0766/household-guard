import { test, expect } from '@playwright/test';
import { freshHouse, signIn } from './helpers.js';

test('S9: an approval made from the house screen (a sandboxed page) books the ride', async ({ page }) => {
  await page.goto(freshHouse());
  await signIn(page, 'maya');
  await page.getByRole('button', { name: 'Book a ride to the airport' }).click();
  await expect(page.getByTestId('alexa-says')).toContainText("Held: over Maya's $20 a week.");
  await signIn(page, 'mom'); // Mom's own phone tap, after the request
  await page.getByTestId('btn-app-approvals').click();
  const frame = page.frameLocator('[data-testid=app-frame]');
  await expect(frame.getByText('Waiting for an adult')).toBeVisible();
  await expect(frame.getByText('Maya wants: ride to the airport')).toBeVisible();
  await expect(frame.getByText('$38')).toBeVisible();
  await page.screenshot({ path: 'test-results/s9-app-approval-card.png' });
  // the frame is closed in: it cannot touch the page around it
  expect(await page.getByTestId('app-frame').getAttribute('sandbox')).toBe('allow-scripts');
  await frame.getByTestId('app-yes').click();
  await expect(frame.getByText('Nothing is waiting.')).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: 'test-results/s9-app-approved.png' });
  // the ride really got booked: the buys screen shows it
  await page.getByTestId('btn-app-orders').click();
  await expect(frame.getByText(/\$38/).first()).toBeVisible({ timeout: 10000 });
});
