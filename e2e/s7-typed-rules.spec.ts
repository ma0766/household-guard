import { test, expect } from '@playwright/test';
import { freshHouse, signIn, confirmOnPhone } from './helpers.js';

// Typed rules: the rule screen takes a plain sentence, reads it back, and saves only after Mom taps her own phone.
const rulesFrame = (page: import('@playwright/test').Page) => page.frameLocator('[data-testid="rules-frame"]');

test('typed rule, clear: "Maya can spend 30 dollars a week" is read back and saved after Mom confirms', async ({ page }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');
  await signIn(page, 'mom');
  await expect(rulesFrame(page).getByText('Maya: $20 a week.')).toBeVisible();
  await page.getByTestId('rule-sentence').fill('Maya can spend 30 dollars a week');
  await page.getByTestId('rule-sentence-go').click();
  // read back in plain words, with the number to match; nothing is saved yet
  await expect(page.getByTestId('rule-readback')).toHaveText("Maya's limit goes from $20 to $30 a week. This lets Maya spend $10 more a week.");
  await expect(says).toContainText('Confirm on your phone:');
  await expect(rulesFrame(page).getByText('Maya: $20 a week.')).toBeVisible();
  await page.screenshot({ path: 'test-results/s7-typed-1-read-back.png', fullPage: true });
  await confirmOnPhone(page, 'mom');
  await expect(says).toHaveText("Maya's limit goes from $20 to $30 a week.");
  await expect(rulesFrame(page).getByText('Maya: $30 a week.')).toBeVisible();
  await expect(rulesFrame(page).getByText('Maya: $20 a week.')).toHaveCount(0);
  await expect(page.getByTestId('rule-typed')).toHaveText('You typed: Maya can spend 30 dollars a week');
  await expect(page.getByTestId('rule-readback')).toContainText("Maya's limit goes from $20 to $30 a week.");
  await page.waitForTimeout(1200); // let the rules frame finish redrawing before the picture
  await expect(rulesFrame(page).getByText('Maya: $30 a week.')).toBeVisible();
  await page.screenshot({ path: 'test-results/s7-typed-2-saved.png', fullPage: true });
  await page.screenshot({ path: 'audit/2026-10-22/typed-rule-read-back-and-saved.png', fullPage: true });
});

test('typed rule, unclear: a question, nothing changes, no number to tap', async ({ page }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');
  await signIn(page, 'mom');
  await page.getByTestId('rule-sentence').fill('Maya can spend a lot');
  await page.getByTestId('rule-sentence-go').click();
  await expect(says).toHaveText('How many dollars a week for Maya?');
  await expect(says).toHaveAttribute('data-outcome', 'held');
  await expect(page.getByTestId('phone-mom')).not.toContainText(/confirm|match/i);
  await page.waitForTimeout(1500);
  await expect(rulesFrame(page).getByText('Maya: $20 a week.')).toBeVisible();
  await page.getByTestId('rule-sentence').fill('make it better');
  await page.getByTestId('rule-sentence-go').click();
  await expect(says).toContainText('I am not sure');
  await expect(rulesFrame(page).getByText('Maya: $20 a week.')).toBeVisible();
  await page.screenshot({ path: 'test-results/s7-typed-unclear.png', fullPage: true });
});

test('typed rule, looser than now: says how much more, saves nothing until Mom taps, and leaves ONE limit', async ({ page }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');
  await signIn(page, 'mom');
  await page.getByTestId('rule-sentence').fill('Maya can spend 50 dollars a week');
  await page.getByTestId('rule-sentence-go').click();
  await expect(page.getByTestId('rule-readback')).toContainText('This lets Maya spend $30 more a week.');
  await expect(says).toContainText('Confirm on your phone:');
  // before the tap Maya's limit is still $20 (the held $35 ride is proven in tests/s7/limits.test.ts)
  await expect(rulesFrame(page).getByText('Maya: $20 a week.')).toBeVisible();
  await page.screenshot({ path: 'test-results/s7-typed-looser.png', fullPage: true });
  await confirmOnPhone(page, 'mom');
  await expect(rulesFrame(page).getByText('Maya: $50 a week.')).toBeVisible();
  await expect(rulesFrame(page).getByText(/Maya: \$/)).toHaveCount(1); // one limit for Maya, replaced, never two
});

test('typed rule: a teen cannot change a rule by typing one', async ({ page }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');
  await signIn(page, 'maya');
  await page.getByTestId('rule-sentence').fill('Maya can spend 500 dollars a week');
  await page.getByTestId('rule-sentence-go').click();
  await expect(says).toHaveText('Ask an adult to change rules.');
});

test('typed rule: a rule said in the question box goes the same way', async ({ page }) => {
  await page.goto(freshHouse());
  await signIn(page, 'mom');
  await page.getByTestId('say').fill('Maya can spend 30 dollars a week');
  await page.getByTestId('btn-say').click();
  await expect(page.getByTestId('rule-readback')).toContainText("Maya's limit goes from $20 to $30 a week.");
});
