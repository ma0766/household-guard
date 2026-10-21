import { test, expect } from '@playwright/test';

// The real thing: the page sends the browser to Amazon Cognito's sign-in page, comes back with a code, trades it (PKCE) for a key.
test('S12 live: sign in on the real sign-in page, come back, and the house answers', async ({ page }) => {
  expect(process.env.LIVE_USER, 'this stage has no family account (deploy it first)').toBeTruthy();
  await page.goto('/?hh=demo');
  await page.getByTestId('btn-signin').click();
  await page.waitForURL(/amazoncognito\.com/);
  await page.screenshot({ path: 'test-results/s12-live-cognito-page.png' });
  await page.locator('input[name="username"]:visible').first().fill(process.env.LIVE_USER!);
  await page.locator('input[name="password"]:visible').first().fill(process.env.LIVE_PASSWORD!);
  await page.locator('input[name="signInSubmitButton"]:visible, button[name="signInSubmitButton"]:visible').first().click();
  await expect(page.getByTestId('account-status')).toHaveText('Signed in with your family account.', { timeout: 30000 });
  await page.getByRole('button', { name: 'Ask: house status' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-token-kind', 'family-account');
  await expect.poll(async () => (await page.getByTestId('log').textContent()) ?? '', { timeout: 15000 }).toMatch(/quiet|waiting/);
  await page.screenshot({ path: 'test-results/s12-live-signed-in.png' });
});
