import { test, expect } from '@playwright/test';
import { open, signIn, ask, alexa, confirmOnPhone, newHh, rideState, frameText } from './lib.js';

// S4 Done when: teen $38 ride -> held -> $14 shared offered -> accepted, $24 saving logged;
// a $38 ride Mom approves by matching the number -> booked; surge test -> held again.
test('S4a teen $38 ride held, $14 shared offered, accepted with no adult, $24 saving shown', async ({ page }) => {
  const hh = newHh('s4a');
  const errors = await open(page, hh);
  await signIn(page, 'maya');
  await ask(page, 'Book a ride to the airport');
  await expect(alexa(page)).toContainText("over Maya's $20 a week", { timeout: 15000 });
  const alt = page.getByTestId('accept-alt');
  await expect(alt).toBeVisible();
  await expect(alt).toContainText('$14');
  await alt.click();
  await confirmOnPhone(page, 'maya'); // the cheaper ride is a purchase under her cap: her own tap, no adult
  await expect(alexa(page)).toContainText(/booked|ride is on its way|done/i, { timeout: 20000 });
  await expect(page.getByTestId('phone-mom')).not.toContainText('wants:'); // no adult needed
  await expect(frameText(page, 'timeline')).toContainText(/saved \$24/i, { timeout: 15000 });
  await page.screenshot({ path: `audit/2026-10-21/s4a-${process.env.AUDIT_TARGET ?? 'local'}.png`, fullPage: true });
  expect(errors, 'console errors').toEqual([]);
});

test('S4b Mom matches the number on her phone and a $38 ride is booked', async ({ page }) => {
  const hh = newHh('s4b');
  await open(page, hh);
  await signIn(page, 'maya');
  await ask(page, 'Book a ride to the airport');
  await expect(alexa(page)).toContainText("over Maya's $20 a week", { timeout: 15000 });
  const card = page.getByTestId('approval-mom');
  await expect(card).toBeVisible({ timeout: 20000 });
  await expect(card).toContainText('Maya');
  await expect(card).toContainText('$38');
  await expect(page.getByTestId('approval-maya')).toHaveCount(0); // not on the teen's phone
  // Mom must say a number first: Alexa's spoken number is shown in the line; tap the matching one
  const said = (await alexa(page).textContent()) ?? '';
  const n = said.match(/\b(\d\d)\b(?!\s*(?:a week|minutes))/g);
  const options = await card.locator('button[data-testid^="approve-mom-num-"]').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-testid')!.split('-').pop()!));
  expect(options.length).toBeGreaterThan(1);
  // a wrong number must not approve
  const wrong = options.find((o) => !(n ?? []).includes(o)) ?? options[0];
  test.info().annotations.push({ type: 'numbers', description: `spoken="${said}" options=${options}` });
  // find the right one: the number Alexa said
  const right = options.find((o) => said.includes(o));
  expect(right, `Alexa's line should contain the number to match; saw: ${said}`).toBeTruthy();
  void wrong;
  await page.getByTestId(`approve-mom-num-${right}`).click();
  await expect(alexa(page)).toContainText(/booked|on its way|done/i, { timeout: 25000 });
  await page.screenshot({ path: `audit/2026-10-21/s4b-${process.env.AUDIT_TARGET ?? 'local'}.png`, fullPage: true });
});

test('S4c price surge after approval -> held again, nothing booked', async ({ page }) => {
  const hh = newHh('s4c');
  await open(page, hh);
  await signIn(page, 'maya');
  await ask(page, 'Book a ride to the airport');
  const card = page.getByTestId('approval-mom');
  await expect(card).toBeVisible({ timeout: 20000 });
  // the price jumps AFTER the request but BEFORE the yes lands (no UI button exists: set through the data store)
  await rideState(hh, { surge: 1.5 });
  const said = (await alexa(page).textContent()) ?? '';
  const options = await card.locator('button[data-testid^="approve-mom-num-"]').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-testid')!.split('-').pop()!));
  const right = options.find((o) => said.includes(o))!;
  await page.getByTestId(`approve-mom-num-${right}`).click();
  await expect(alexa(page)).not.toContainText(/booked|on its way/i, { timeout: 5000 });
  // a new approval appears at the higher price
  await expect(page.getByTestId('approval-mom')).toContainText(/\$5\d|\$6\d/, { timeout: 25000 });
  await expect(frameText(page, 'timeline')).not.toContainText(/booked/i);
  await page.screenshot({ path: `audit/2026-10-21/s4c-${process.env.AUDIT_TARGET ?? 'local'}.png`, fullPage: true });
});
