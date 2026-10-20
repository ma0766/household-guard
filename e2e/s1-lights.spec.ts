import { test, expect } from '@playwright/test';
import { freshHouse, signIn, confirmOnPhone } from './helpers.js';

test('S1: teen lights → done; teen unlock → denied; delete account → denied', async ({ page }) => {
  await page.goto(freshHouse());
  await signIn(page, 'maya');
  await page.getByRole('button', { name: 'Turn off the lights' }).click();
  await expect(page.getByTestId('alexa-says')).toHaveText('Done. The lights are off.');
  await page.getByRole('button', { name: 'Unlock the front door' }).click();
  await expect(page.getByTestId('alexa-says')).toHaveText('Only adults can do that.');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page.getByTestId('alexa-says')).toHaveText("I can't do that.");
  await page.screenshot({ path: 'test-results/s1-denied.png' });
  await signIn(page, 'mom');
  await page.getByRole('button', { name: 'Unlock the front door' }).click();
  await confirmOnPhone(page, 'mom');
  await expect(page.getByTestId('alexa-says')).toContainText('unlocked');
});
