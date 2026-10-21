import { expect, type Page } from '@playwright/test';
export const fresh = () => `/?hh=aud${Date.now()}${Math.floor(Math.random() * 1e6)}`;
export const STANDIN_WORDS = /stand-?in|sample|simulat|demo|mock|fake|not real|placeholder|test mode|pretend/i;
export async function tapNumber(page: Page, who: 'mom' | 'maya') {
  const says = page.getByTestId('alexa-says');
  await expect(says).toContainText('Confirm on your phone:');
  const n = (await says.textContent())!.match(/(\d\d)\s*$/)![1];
  await page.getByTestId(`phone-${who}-num-${n}`).click();
}
export async function signIn(page: Page, who: 'mom' | 'maya') {
  await page.getByTestId(`who-${who}`).click();
  await tapNumber(page, who);
  await expect(page.getByTestId('alexa-says')).toHaveText(/are confirmed|^Done\.?$/); // prod sometimes shows a bare "Done." (recorded as a UX finding)
}
// Write what a person sees on screen (page text + text inside every frame) so a judge's view is on record.
export async function visibleText(page: Page): Promise<string> {
  const parts = [await page.locator('body').innerText()];
  for (const f of page.frames()) if (f !== page.mainFrame()) parts.push(await f.locator('body').innerText().catch(() => ''));
  return parts.join('\n');
}
export function watchConsole(page: Page) {
  const errs: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  return errs;
}
