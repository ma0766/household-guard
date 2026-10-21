import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { open, signIn, ask, alexa, confirmOnPhone, newHh, frameText } from './lib.js';

const T = process.env.AUDIT_TARGET ?? 'local';
// NOTE: each person may get only 3 phone pushes per 10 minutes (S2), and rule edits count too, so the flow is split across fresh households.

// S7 Done when: Mom changes Maya's limit from the card and the next decision follows it; a teen's attempt is denied; undo restores the old rule.
test('S7a limit change is followed by the next decision; teen cannot change a rule', async ({ page }) => {
  const hh = newHh('s7a');
  const errors = await open(page, hh);
  const rules = frameText(page, 'rules-frame');
  const words = async () => (await rules.innerText()).replace(/\s+/g, ' ');

  await signIn(page, 'maya'); // kids can look at their own rules once confirmed
  await expect(rules).toContainText(/Maya: \$20 a week/ , { timeout: 15000 });
  writeFileSync(`audit/2026-10-21/s7-rules-before-${T}.txt`, await words() + '\n');
  await ask(page, 'Book a ride to the airport');
  await expect(alexa(page)).toContainText("over Maya's $20 a week", { timeout: 20000 });

  // the teen cannot change a rule
  await page.getByTestId('rule-maya-limit').fill('99');
  await page.getByTestId('rule-save-maya').click();
  await expect(alexa(page)).toHaveAttribute('data-outcome', 'denied', { timeout: 15000 });
  test.info().annotations.push({ type: 'teen-refusal-wording', description: (await alexa(page).innerText()).trim() });
  await expect(page.locator('[data-testid^="phone-maya-num-"]')).toHaveCount(0);
  await expect(rules).not.toContainText('$99');
  await page.screenshot({ path: `audit/2026-10-21/s7-teen-denied-${T}.png`, fullPage: true });

  // Mom raises the limit to $50 on the card, with her own phone tap
  await signIn(page, 'mom');
  await page.getByTestId('rule-maya-limit').fill('50');
  await page.getByTestId('rule-save-maya').click();
  await expect(page.getByTestId('rule-preview')).not.toBeEmpty({ timeout: 10000 });
  const preview = (await page.getByTestId('rule-preview').innerText()).trim();
  test.info().annotations.push({ type: 'preview-before-tap', description: preview });
  expect(preview).toMatch(/\$30 more/); // plain-language warning names the change before it is saved
  await expect(rules).not.toContainText(/Maya: \$50 a week/ ); // nothing changed before the tap
  await confirmOnPhone(page, 'mom');
  await expect(rules).toContainText(/Maya: \$50 a week/ , { timeout: 15000 });
  await page.screenshot({ path: `audit/2026-10-21/s7-limit50-${T}.png`, fullPage: true });

  // the next decision follows the new rule
  await signIn(page, 'maya');
  await expect(rules).toContainText(/Maya: \$50 a week/ , { timeout: 15000 });
  await ask(page, 'Book a ride to the airport');
  await expect(alexa(page)).toContainText(/Confirm on your phone/i, { timeout: 20000 });
  await expect(alexa(page)).not.toContainText(/over Maya's/);
  expect(errors.filter((e) => !/Blocked script execution/.test(e)), 'console errors other than sandbox').toEqual([]);
});

test('S7b undo restores the old rule and the next decision follows it', async ({ page }) => {
  const hh = newHh('s7b');
  await open(page, hh);
  const rules = frameText(page, 'rules-frame');
  await signIn(page, 'mom'); // push 1 of 3
  await page.getByTestId('rule-maya-limit').fill('50');
  await page.getByTestId('rule-save-maya').click(); // push 2
  await confirmOnPhone(page, 'mom');
  await expect(rules).toContainText(/Maya: \$50 a week/ , { timeout: 15000 });
  await page.getByTestId('rule-undo').click(); // push 3
  await confirmOnPhone(page, 'mom');
  await expect(rules).toContainText(/Maya: \$20 a week/ , { timeout: 15000 });
  await expect(rules).not.toContainText(/Maya: \$50 a week/ );
  writeFileSync(`audit/2026-10-21/s7-rules-after-undo-${T}.txt`, (await rules.innerText()).replace(/\s+/g, ' ') + '\n');
  await signIn(page, 'maya');
  await ask(page, 'Book a ride to the airport');
  await expect(alexa(page)).toContainText("over Maya's $20 a week", { timeout: 20000 });
  await page.screenshot({ path: `audit/2026-10-21/s7-undone-${T}.png`, fullPage: true });
});

test('S7c quiet hours card: plain preview before saving, saved after Mom taps', async ({ page }) => {
  const hh = newHh('s7c');
  await open(page, hh);
  await signIn(page, 'mom');
  await page.getByTestId('rule-quiet-on').click();
  await expect(page.getByTestId('rule-preview')).not.toBeEmpty({ timeout: 10000 });
  const qp = (await page.getByTestId('rule-preview').innerText()).trim();
  test.info().annotations.push({ type: 'quiet-preview', description: qp });
  expect(qp).toMatch(/9 ?PM|9:00|quiet|night/i);
  await confirmOnPhone(page, 'mom');
  await expect(frameText(page, 'rules-frame')).toContainText(/9 ?PM|quiet/i, { timeout: 15000 });
  await page.screenshot({ path: `audit/2026-10-21/s7-quiet-${T}.png`, fullPage: true });
});

test('S7d locked safety rules warn before change', async () => {
  test.skip(true, 'MANUAL: the web client has no control for the two locked rules ("children cannot unlock", "guests cannot buy"); they are only reachable by calling set_rule directly, which this audit may not do. Covered by tests/s7 (vitest).');
});
