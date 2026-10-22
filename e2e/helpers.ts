import { expect, type Page } from '@playwright/test';

export const freshHouse = () => `/?hh=e${Date.now()}${Math.floor(Math.random() * 1e6)}`;

// Alexa says "Confirm on your phone: NN" → the person taps NN on their own phone.
export async function confirmOnPhone(page: Page, who: 'mom' | 'maya' | 'grandma') {
  const says = page.getByTestId('alexa-says');
  await expect(says).toContainText('Confirm on your phone:');
  const n = (await says.textContent())!.match(/(\d\d)\s*$/)![1];
  await page.getByTestId(`phone-${who}-num-${n}`).click();
}

export async function signIn(page: Page, who: 'mom' | 'maya' | 'grandma') {
  await page.getByTestId(`who-${who}`).click();
  await confirmOnPhone(page, who);
  await expect(page.getByTestId('alexa-says')).toContainText('are confirmed');
}
