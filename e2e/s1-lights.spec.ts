import { test, expect } from '@playwright/test';

test('S1: teen lights → done; teen unlock → denied; delete account → denied', async ({ page }) => {
  await page.goto(`/?hh=e${Date.now()}${Math.floor(Math.random() * 1e6)}`);
  await page.getByTestId('who-maya').click();
  await page.getByRole('button', { name: 'Turn off the lights' }).click();
  await expect(page.getByTestId('alexa-says')).toHaveText('Done. The lights are off.');
  await page.getByRole('button', { name: 'Unlock the front door' }).click();
  await expect(page.getByTestId('alexa-says')).toHaveText('Only adults can do that.');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page.getByTestId('alexa-says')).toHaveText("I can't do that.");
  await page.screenshot({ path: 'test-results/s1-denied.png' });
  await page.getByTestId('who-mom').click();
  await page.getByRole('button', { name: 'Unlock the front door' }).click();
  await expect(page.getByTestId('alexa-says')).toContainText('unlocked');
});
