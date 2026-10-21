import { test, expect } from '@playwright/test';
import { freshHouse, signIn, confirmOnPhone } from './helpers.js';

test('S13: a teen connects a music app with her own sign-in; Mom is not connected; a new app waits for an adult first', async ({ page, browser }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');
  await signIn(page, 'maya');

  // a new app is held until an adult allows it
  await page.getByTestId('btn-play-jazz').click();
  await expect(says).toContainText("That's new here. An adult must say yes.");

  // Mom allows it from the house rules
  await signIn(page, 'mom');
  await page.getByTestId('btn-allow-spotify').click();
  await confirmOnPhone(page, 'mom');
  await expect(says).toContainText('Allowed apps:');

  // Maya is not connected yet; she connects with a code to scan, on her own phone
  await signIn(page, 'maya');
  await page.getByTestId('btn-play-jazz').click();
  await expect(says).toHaveText('Connect Spotify first.');
  await page.getByTestId('btn-connect-spotify').click();
  const frame = page.frameLocator('[data-testid=app-frame]');
  await expect(frame.getByTestId('app-qr')).toBeVisible();
  const link = (await frame.getByTestId('app-link').textContent())!;
  expect(link).toMatch(/\/standin\/connect\//);
  await page.screenshot({ path: 'test-results/s13-connect-qr.png' });
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 600 } })).newPage();
  await phone.goto(link);
  await phone.getByTestId('standin-allow').click();
  await expect(phone.getByTestId('standin-out')).toHaveText('Connected. You can close this page.');

  await page.getByTestId('btn-play-jazz').click();
  await expect(says).toHaveText('Done with Spotify: play jazz.');
  await page.screenshot({ path: 'test-results/s13-played.png' });

  // Mom signed in to nothing: her sign-in is hers, not Maya's
  await signIn(page, 'mom');
  await page.getByTestId('btn-play-jazz').click();
  await expect(says).toHaveText('Connect Spotify first.');
});
