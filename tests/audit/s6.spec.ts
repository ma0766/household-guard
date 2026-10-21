import { test, expect } from '@playwright/test';
import { open, signIn, ask, alexa, confirmOnPhone, newHh, frameText, store, auditKey, verifyCli, isProd } from './lib.js';
import { writeFileSync } from 'node:fs';

const T = process.env.AUDIT_TARGET ?? 'local';

// S6 Done when: a verify script catches an edited row; a person who has never seen the app finds last week's purchases in under 30 s.
test('S6 timeline in plain sentences, filters by person and day, voice summary, edited row caught by verify script', async ({ page }) => {
  const hh = newHh('s6');
  const errors = await open(page, hh);
  // build a story: Maya's $38 ride held -> $14 shared accepted; Mom turns off the lights
  await signIn(page, 'maya');
  await ask(page, 'Book a ride to the airport');
  await expect(alexa(page)).toContainText("over Maya's $20 a week", { timeout: 20000 });
  await page.getByTestId('accept-alt').click();
  await confirmOnPhone(page, 'maya');
  await expect(alexa(page)).toContainText(/booked/i, { timeout: 25000 });
  await signIn(page, 'mom');
  await ask(page, 'Turn off the lights');
  await expect(alexa(page)).toContainText(/off|done|lights/i, { timeout: 15000 });

  const tl = frameText(page, 'timeline');
  // plain sentences, each one icon, no tech words
  await expect(tl).toContainText(/Maya asked for a \$38 ride at \d{1,2}:\d\d [AP]M\. Held: over Maya's \$20 a week\./, { timeout: 20000 });
  await expect(tl).toContainText(/saved \$24/i);
  await expect.soft(tl, 'SLICES S6: one icon per kind (cart, lock, light, rule change): a lights action by Mom should appear').toContainText(/light/i, { timeout: 8000 });
  const all = (await tl.innerText()).trim();
  writeFileSync(`audit/2026-10-21/s6-timeline-${T}.txt`, all + '\n');
  expect(all).not.toMatch(/\b(policy|cedar|token|mcp|schema|json|error code|undefined|null|NaN)\b/i);
  await page.screenshot({ path: `audit/2026-10-21/s6-all-${T}.png`, fullPage: true });

  // filter by person
  const t0 = Date.now();
  await page.getByTestId('tl-person').selectOption('maya');
  await expect(tl).not.toContainText(/Mom/, { timeout: 10000 });
  await expect(tl).toContainText('Maya');
  await page.screenshot({ path: `audit/2026-10-21/s6-maya-${T}.png`, fullPage: true });
  await page.getByTestId('tl-person').selectOption('mom');
  await expect(tl).not.toContainText(/Maya asked/, { timeout: 10000 });
  await expect(tl).toContainText(/Mom/);
  await page.getByTestId('tl-person').selectOption('');
  // filter by day: today shows entries; the sentences are the same
  await page.getByTestId('tl-day').selectOption('today');
  await expect(tl).toContainText(/Maya asked/, { timeout: 10000 });
  // voice summary: totals first, short
  await page.getByTestId('btn-kids-week').click();
  const sum = page.getByTestId('summary');
  await expect(sum).toBeVisible({ timeout: 10000 });
  const s = (await sum.innerText()).trim();
  writeFileSync(`audit/2026-10-21/s6-summary-${T}.txt`, s + '\n');
  expect(s).toMatch(/\$14/);
  expect.soft(s.split(/[.!?]+\s/).filter(Boolean).length, `spec: voice summary is two or three sentences; got: ${s}`).toBeLessThanOrEqual(3);
  test.info().annotations.push({ type: 'find-in-seconds', description: `person+day filter + summary done in ${(Date.now() - t0) / 1000}s` });
  expect.soft(errors.filter((e) => !/Blocked script execution/.test(e)), 'console errors other than sandbox').toEqual([]);
  test.info().annotations.push({ type: 'sandbox-console-errors', description: String(errors.length) });

  // CLI: clean log passes, edited row is caught
  const clean = verifyCli(hh);
  const st = store();
  await st.update({ Key: auditKey(hh, 2), UpdateExpression: 'SET #t = :t', ExpressionAttributeNames: { '#t': 'text' }, ExpressionAttributeValues: { ':t': 'Nothing happened. (edited by auditor)' } });
  const bad = verifyCli(hh);
  const cmd = isProd() ? `npm run audit:verify -- ${hh}` : `npm run audit:verify -- ${hh} --local`;
  writeFileSync(`audit/2026-10-21/s6-verify-cli-${T}.log`, `$ ${cmd}   (before edit)\nexit ${clean.code}\n${clean.out}\n$ ${cmd}   (after editing text of AUDIT#2)\nexit ${bad.code}\n${bad.out}\n`);
  expect(clean.code, clean.out).toBe(0);
  expect(bad.code, bad.out).toBe(1);
  expect(bad.out).toMatch(/BROKEN at entry 2: an entry was edited/);
});
