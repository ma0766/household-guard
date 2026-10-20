import { test, expect } from '@playwright/test';

test('S0: web client lists the tool and gets an answer', async ({ page }) => {
  await page.goto(`/?hh=e${Date.now()}${Math.floor(Math.random() * 1e6)}`);
  await page.getByRole('button', { name: 'List tools' }).click();
  await expect(page.getByTestId('log')).toContainText('household_status');
  await page.getByRole('button', { name: 'Ask: house status' }).click();
  await expect(page.getByTestId('log')).toContainText('Your house is quiet');
  await page.screenshot({ path: 'test-results/s0-web-client.png' });
});
