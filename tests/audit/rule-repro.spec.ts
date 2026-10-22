import { test } from '@playwright/test';
import { freshHouse, signIn } from '../../e2e/helpers.js';

// Repro for the goal: as Mom, add a rule the way a user would. Records what happens (not an assertion test).
test('repro: Mom types a plain rule sentence', async ({ page }) => {
  const errs: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(freshHouse());
  await signIn(page, 'mom');
  await page.screenshot({ path: 'audit/2026-10-22/repro-1-mom-signed-in.png', fullPage: true });
  await page.getByTestId('say').fill('Maya can spend 30 dollars a week');
  await page.getByTestId('btn-say').click();
  await page.waitForTimeout(1500);
  const says = await page.getByTestId('alexa-says').textContent();
  const rules = await page.frameLocator('[data-testid="rules-frame"]').locator('body').innerText();
  await page.screenshot({ path: 'audit/2026-10-22/repro-2-typed-sentence.png', fullPage: true });
  console.log('ALEXA SAYS:', says, '| console errors:', JSON.stringify(errs), '| RULES FRAME:', rules.replace(/\n/g, ' / '));
});
