import { test, expect, type Page } from '@playwright/test';
import { house, says, outcome, quick, signIn, tap, timeline } from './_lib';

// Click the same quick button twice in one browser task = two ride asks at the same moment.
async function fireTwice(page: Page, label: string) {
  await page.evaluate((l) => {
    const b = [...document.querySelectorAll('#quick button')].find((x) => x.textContent!.startsWith(l))! as HTMLElement;
    b.click(); b.click();
  }, label);
}
const logText = (page: Page) => page.getByTestId('log').textContent().then((t) => t ?? '');
const leftLine = async (page: Page) => {
  await page.getByRole('button', { name: 'Ask: house status' }).click();
  await expect(page.getByTestId('log')).toContainText('has $');
  const m = [...(await logText(page)).matchAll(/Maya has \$(\d+) left this week/g)];
  return m.length ? Number(m[m.length - 1][1]) : undefined;
};

test('S3 two $15 rides at once vs Maya\'s $20 cap -> exactly one booked, one held', async ({ page }) => {
  await page.goto(house('a3'));
  await signIn(page, 'maya');
  await page.getByTestId('log').evaluate((e) => (e.textContent = ''));
  await fireTwice(page, 'Book a ride to the mall');
  await expect.poll(async () => (await logText(page)).match(/Confirm on your phone: \d\d/g)?.length ?? 0, { timeout: 10000 }).toBeGreaterThan(0);
  const log = await logText(page);
  const held = (log.match(/"why": "cap_race"/g) ?? []).length + (log.match(/Held: over Maya's \$20 a week/g) ?? []).length;
  expect(held, 'one of the two asks must be held for the cap').toBeGreaterThan(0);
  const n = log.match(/Confirm on your phone: (\d\d)/)![1];
  await tap(page, 'maya', n);
  await expect(timeline(page)).toContainText('Ride booked for Maya', { timeout: 20000 });
  await page.waitForTimeout(2500);
  const tl = (await timeline(page).innerText());
  const booked = (tl.match(/Ride booked for Maya/g) ?? []).length;
  expect(booked, 'rides booked').toBe(1);
  expect((tl.match(/Held: over Maya's \$20 a week/g) ?? []).length, 'held lines').toBeGreaterThanOrEqual(1);
  expect(await leftLine(page), 'Maya has $5 left, not $-10 or $20').toBe(5);
  // Mom's phone has the held one waiting, nothing was silently booked
  await expect(page.getByTestId('phone-mom')).toContainText('Maya wants', { timeout: 8000 });
  await page.screenshot({ path: `audit/2026-10-21/s3-concurrency-${process.env.AUDIT_TARGET}.png` });
});

test('S3 the ride held for the cap reaches Mom\'s phone (even before Maya taps her own phone)', async ({ page }) => {
  await page.goto(house('a3'));
  await signIn(page, 'maya');
  await fireTwice(page, 'Book a ride to the mall');
  // Alexa said "An adult can tap NN to say yes" - so an adult must be able to see that card
  await expect(says(page)).toContainText(/Held|Confirm on your phone/, { timeout: 10000 });
  await expect(page.getByTestId('phone-mom')).toContainText('Maya wants', { timeout: 12000 });
  await expect(page.getByTestId('phone-mom')).toContainText('$15');
});

test('S3 duplicate: the same request_id sent twice (an Alexa retry) books ONE ride', async ({ page }) => {
  await page.goto(house('a3'));
  await signIn(page, 'maya');
  await page.getByTestId('log').evaluate((e) => (e.textContent = ''));
  // Browser fetch to the same /mcp endpoint the page uses, same request_id twice, in parallel.
  const res = await page.evaluate(async () => {
    const hh = new URLSearchParams(location.search).get('hh')!;
    const tok = (await (await fetch(`/demo-token?hh=${hh}`)).json()).token;
    const call = (id: number) => fetch('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${tok}` }, body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'request_action', arguments: { service: 'mock-ride', action: 'purchase', item: 'ride to the library', request_id: 'audit-dup-1' } } }) }).then((r) => r.text());
    const [a, b] = await Promise.all([call(1), call(2)]);
    const c = await call(3); // and a third, later retry
    return [a, b, c].map((t) => JSON.parse(t.includes('data: ') ? t.replace(/^[\s\S]*?data: /, '').trim() : t).result.structuredContent);
  });
  console.log('dup replies', JSON.stringify(res.map((r: any) => [r.outcome, r.say, r.job_id])));
  const jobs = new Set(res.map((r: any) => r.job_id).filter(Boolean));
  expect(jobs.size, 'distinct jobs from 3 identical calls').toBeLessThanOrEqual(1);
  const n = (res.find((r: any) => /Confirm on your phone/.test(r.say ?? '')).say as string).match(/(\d\d)/)![1];
  await tap(page, 'maya', n);
  await expect(timeline(page)).toContainText('Ride booked for Maya', { timeout: 20000 });
  await page.waitForTimeout(3000);
  const tl = await timeline(page).innerText();
  expect((tl.match(/Ride booked for Maya/g) ?? []).length, 'rides booked').toBe(1);
  expect(await leftLine(page), 'only one ride charged').toBe(5);
});

test('S3 teen over the cap in one go ($38 airport) is held with a plain reason, not booked', async ({ page }) => {
  await page.goto(house('a3'));
  await signIn(page, 'maya');
  await quick(page, 'Book a ride to the airport');
  await expect(says(page)).not.toHaveText('Alexa is listening.');
  await expect.poll(() => outcome(page)).toBe('held');
  await expect(says(page)).toContainText(/over|limit|adult/i);
  await page.waitForTimeout(1500);
  await expect(timeline(page)).not.toContainText('Ride booked');
});
