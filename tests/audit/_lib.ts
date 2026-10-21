import { expect, type Page } from '@playwright/test';
export const house = (p: string) => `/?hh=${p}${Date.now()}${Math.floor(Math.random() * 1e6)}`;
export const says = (page: Page) => page.getByTestId('alexa-says');
export const outcome = (page: Page) => says(page).getAttribute('data-outcome');
export async function sayIt(page: Page, text: string) {
  await page.getByTestId('say').fill(text);
  await page.getByTestId('btn-say').click();
}
export async function quick(page: Page, label: string) {
  await page.locator('#quick button', { hasText: label }).click();
}
export const numFrom = async (page: Page) => {
  await expect(says(page)).toContainText('Confirm on your phone:', { timeout: 10000 });
  return (await says(page).textContent())!.match(/Confirm on your phone: (\d\d)/)![1];
};
// wait until Alexa's line changes from `prev`, then return it
export async function nextSays(page: Page, prev: string) {
  await expect(says(page)).not.toHaveText(prev, { timeout: 10000 });
  await page.waitForTimeout(300);
  return (await says(page).textContent())!;
}
// phone buttons are re-drawn every second, so click through the DOM instead of waiting for "stable"
export async function tap(page: Page, who: string, n: string, kind: 'num' | 'approve' = 'num') {
  const loc = page.getByTestId(kind === 'num' ? `phone-${who}-num-${n}` : `approve-${who}-num-${n}`);
  await expect(loc).toHaveCount(1, { timeout: 10000 });
  await loc.evaluate((e: HTMLElement) => e.click());
}
export async function signIn(page: Page, who: 'mom' | 'maya') {
  await page.getByTestId(`who-${who}`).click();
  await expect(says(page)).toContainText('Confirm on your phone:');
  await tap(page, who, await numFrom(page));
  await expect(says(page)).toHaveText(/is confirmed|^Done\.$/, { timeout: 10000 });
}
export const timeline = (page: Page) => page.frameLocator('[data-testid=timeline]').locator('body');
export const BANNED = /\b(policy|cedar|token|mcp|schema|json|error code)\b/i;
