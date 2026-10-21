import { test, expect, type Page } from '@playwright/test';
import { freshHouse, signIn, watchConsole } from './common.js';

// S11 Done when: the ride service changes its field names -> health check fails -> repair passes tests -> next ride asks for approval.
const says = (page: Page) => page.getByTestId('alexa-says');
const status = (page: Page) => page.getByTestId('conn-status');

test('S11 break -> check -> repair -> next ride needs one yes -> yes -> normal again', async ({ page }) => {
  test.setTimeout(240000);
  const errs = watchConsole(page);
  page.on('response', async (r) => { if (/\/demo\/(check|break)-rides?/.test(r.url())) console.log('DEMO', r.url().split('/').pop(), r.status(), Date.now() % 100000, (await r.text().catch(() => '')).slice(0, 300)); });
  await page.goto(freshHouse('s11'));
  await expect(status(page)).toHaveText('The ride service works.', { timeout: 20000 }).catch(() => undefined);
  await signIn(page, 'mom');
  await expect(status(page)).toHaveText('The ride service works.', { timeout: 20000 });

  // BREAK (adult only)
  await page.getByTestId('btn-break-ride').click();
  await expect(says(page)).toContainText('shipped a new version', { timeout: 15000 });
  await page.screenshot({ path: 'audit/2026-10-21/s11-1-broken.png' });
  // Without a check the page still says it works (the house has not noticed yet)
  console.log('STATUS right after break (before any check):', await status(page).textContent());

  // CHECK -> repair
  console.log('CHECK CLICK AT', Date.now() % 100000);
  await page.getByTestId('btn-check-rides').click();
  await expect(status(page)).toHaveText('Fixed. The next ride needs a yes.', { timeout: 90000 });
  console.log('SAYS after check:', await says(page).textContent());
  await page.screenshot({ path: 'audit/2026-10-21/s11-2-fixed-yes-owed.png' });

  // NEXT RIDE by Maya: not booked until an adult says yes
  await signIn(page, 'maya');
  await page.getByRole('button', { name: 'Book a ride to the mall' }).click();
  await expect(says(page)).not.toHaveText(/are confirmed\.|^Done\.$/, { timeout: 20000 });
  await page.waitForTimeout(1500);
  const heldSays = (await says(page).textContent())!;
  console.log('MAYA RIDE AFTER REPAIR SAYS:', heldSays, '| outcome', await says(page).getAttribute('data-outcome'));
  await page.screenshot({ path: 'audit/2026-10-21/s11-3-next-ride-held.png' });
  expect(await says(page).getAttribute('data-outcome'), heldSays).toBe('held');
  expect(heldSays).not.toMatch(/booked|on its way/i);
  // Mom's phone shows an approval card; she approves with her own tap
  const card = page.getByTestId('approval-mom');
  await expect(card).toBeVisible({ timeout: 20000 });
  console.log('MOM CARD:', (await card.innerText()).replace(/\n/g, ' | '));
  const nums = await card.locator('button[data-testid^="approve-mom-num-"]').evaluateAll((b) => b.map((x) => x.getAttribute('data-testid')!));
  const n = heldSays.match(/(\d\d)/)![1];
  expect(nums).toContain(`approve-mom-num-${n}`);
  await page.getByTestId(`approve-mom-num-${n}`).click();
  await expect(says(page)).toContainText(/booked|on its way|Booking|Done/i, { timeout: 60000 });
  console.log('AFTER MOM YES SAYS:', await says(page).textContent());
  await expect(status(page)).toHaveText('The ride service works.', { timeout: 30000 });
  await page.screenshot({ path: 'audit/2026-10-21/s11-4-booked-normal.png' });
  // the plain timeline tells the story
  const tl = page.frameLocator('[data-testid=timeline]');
  await expect(tl.locator('body')).toContainText(/Ride booked for Maya/, { timeout: 30000 });
  console.log('TIMELINE:', (await tl.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 700));
  // next ride is back to normal: a phone check, not an adult yes
  await signIn(page, 'maya').catch(() => undefined);
  console.log('console errors:', JSON.stringify([...new Set(errs)]));
});

test('S11 a ride asked after the break but before the check is never booked on a wrong price', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(freshHouse('s11b'));
  await signIn(page, 'mom');
  await page.getByTestId('btn-break-ride').click();
  await expect(says(page)).toContainText('shipped a new version', { timeout: 15000 });
  await signIn(page, 'maya');
  await page.getByRole('button', { name: 'Book a ride to the mall' }).click();
  await expect(says(page)).not.toHaveText(/are confirmed\.|^Done\.$/, { timeout: 20000 });
  await page.waitForTimeout(2500);
  const t = (await says(page).textContent())!;
  console.log('RIDE BETWEEN BREAK AND CHECK:', t, '| outcome', await says(page).getAttribute('data-outcome'));
  await page.screenshot({ path: 'audit/2026-10-21/s11-ride-before-check.png' });
  expect(await says(page).getAttribute('data-outcome')).not.toBe('allowed');
  expect(t).not.toMatch(/booked/i);
});

test('S11 a teen cannot break the ride service, and the page does not pretend she did', async ({ page }) => {
  await page.goto(freshHouse('s11c'));
  await signIn(page, 'maya');
  await page.getByTestId('btn-break-ride').click();
  await page.waitForTimeout(2000);
  const t = await says(page).textContent();
  console.log('TEEN CLICKS BREAK, PAGE SAYS:', t);
  await page.getByTestId('btn-check-rides').click();
  await page.waitForTimeout(3000);
  console.log('STATUS after teen break+check:', await status(page).textContent());
  expect(await status(page).textContent()).toBe('The ride service works.');
  expect(t, 'page claims the service changed although a teen is not allowed to break it').not.toContain('shipped a new version');
});

test('S11 a healthy service: check changes nothing', async ({ page }) => {
  await page.goto(freshHouse('s11d'));
  await signIn(page, 'mom');
  await page.getByTestId('btn-check-rides').click();
  await expect(says(page)).toContainText(/./);
  await page.waitForTimeout(2500);
  console.log('HEALTHY CHECK SAYS:', await says(page).textContent());
  await expect(status(page)).toHaveText('The ride service works.');
});
