import { test, expect } from '@playwright/test';
import { freshHouse, signIn, confirmOnPhone } from './helpers.js';

test('S5: a voucher the rules allow is held by the risk check; Mom says yes by number', async ({ page }) => {
  await page.goto(freshHouse());
  await signIn(page, 'maya');
  await page.getByRole('button', { name: 'Buy a voucher' }).click();
  await confirmOnPhone(page, 'maya');
  const says = page.getByTestId('alexa-says');
  await expect(says).toContainText('That needs a closer look.');
  await page.screenshot({ path: 'test-results/s5-risk-hold.png' });
  await expect(page.getByTestId('approval-mom')).toContainText('voucher');
  const n = (await says.textContent())!.match(/tap (\d\d) to say yes/)![1];
  await page.getByTestId(`approve-mom-num-${n}`).click();
  await expect(says).toHaveText('Done. You spent $15.');
});
