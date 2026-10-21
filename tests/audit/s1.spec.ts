import { test, expect } from '@playwright/test';
import { house, says, outcome, quick, sayIt, signIn, BANNED, timeline } from './_lib';

test('S1 teen: lights -> done; unlock -> denied in plain words; delete account -> denied', async ({ page }) => {
  await page.goto(house('a1'));
  await signIn(page, 'maya');
  await quick(page, 'Turn off the lights');
  await expect(says(page)).toContainText('Done. The lights are off.');
  expect(await outcome(page)).toBe('allowed');

  await quick(page, 'Unlock the front door');
  await expect(says(page)).not.toContainText('Done');
  await expect.poll(() => outcome(page)).toBe('denied');
  const why = (await says(page).textContent())!;
  expect(why.length).toBeGreaterThan(8);
  expect(why).toMatch(/adult/i);           // a reason a person understands
  expect(why).not.toMatch(BANNED);
  await page.screenshot({ path: `audit/2026-10-21/s1-unlock-denied-${process.env.AUDIT_TARGET}.png` });

  await quick(page, 'Delete my account');
  await expect.poll(() => outcome(page)).toBe('denied');
  await expect(says(page)).not.toContainText('Done');
  expect((await says(page).textContent())!).not.toMatch(BANNED);

  // the door never opened: the log says nothing like "unlocked"
  await expect(timeline(page)).not.toContainText(/unlocked/i);
});

test('S1 typed words: unknown service action and odd phrasing are denied or not understood, never done', async ({ page }) => {
  await page.goto(house('a1'));
  await signIn(page, 'maya');
  await sayIt(page, 'please delete account now');
  await expect.poll(() => outcome(page)).toBe('denied');
  await sayIt(page, 'open the pod bay doors');
  await expect(says(page)).toContainText("didn't get that");
  await sayIt(page, 'unlock the front door');
  await expect.poll(() => outcome(page)).toBe('denied');
});

test('S1 guest (nobody confirmed): lights ok, unlock and delete denied', async ({ page }) => {
  await page.goto(house('a1'));
  await quick(page, 'Turn off the lights');
  await expect(says(page)).toContainText('Done');
  await quick(page, 'Unlock the front door');
  await expect.poll(() => outcome(page)).toBe('denied');
  await quick(page, 'Delete my account');
  await expect.poll(() => outcome(page)).toBe('denied');
});

test('S1 adult: Mom (confirmed on her phone) can unlock', async ({ page }) => {
  await page.goto(house('a1'));
  await signIn(page, 'mom');
  await quick(page, 'Unlock the front door');
  // unlock is a high-risk action: expect either done or a wait for her own phone tap, never denied
  await expect.poll(async () => (await outcome(page)) !== 'denied', { timeout: 8000 }).toBe(true);
});
