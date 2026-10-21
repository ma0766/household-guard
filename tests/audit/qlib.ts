import { type Page } from '@playwright/test';
import { freshHouse, signIn } from '../../e2e/helpers.js';

// Shared by the Part C specs: type and send, read every bit of text on screen, and walk the app into the states a person sees.
const date = process.env.AUDIT_DATE ?? '2026-10-21';
const target = process.env.AUDIT_TARGET ?? 'local';
const dir = `audit/${date}`;

export async function say(page: Page, text: string) { await page.getByTestId('say').fill(text); await page.getByTestId('btn-say').click(); await page.waitForTimeout(800); }
export async function allText(page: Page): Promise<{ where: string; text: string }[]> {
  const out = [{ where: 'page', text: await page.locator('main').innerText() }];
  for (const f of page.frames().slice(1)) { try { out.push({ where: `frame:${await f.name() || f.url().slice(0, 40)}`, text: await f.locator('body').innerText({ timeout: 1500 }) }); } catch { /* empty frame */ } }
  return out;
}
// walk the app into the states a person sees: lights, a held ride with an offer, a phone card, the timeline, a rule card
export async function tour(page: Page) {
  await page.goto(freshHouse() + '&dad=1'); await page.waitForLoadState('networkidle');
  const shots: string[] = [];
  const snap = async (n: string) => { shots.push(n); await page.screenshot({ path: `${dir}/C-${target}-${n}.png`, fullPage: true }); };
  await snap('1-start');
  await page.getByTestId('who-guest').click(); await say(page, 'turn off the lights'); await snap('2-guest-lights');
  await say(page, 'unlock the front door'); await snap('3-guest-unlock-denied');
  await signIn(page, 'maya'); await say(page, 'book a ride to the airport'); await snap('4-teen-ride-held');
  await page.getByTestId('btn-app-approvals').click().catch(() => undefined); await page.waitForTimeout(800); await snap('5-approvals-screen');
  await page.getByTestId('btn-app-orders').click().catch(() => undefined); await page.waitForTimeout(800); await snap('6-orders-screen');
  await page.getByTestId('btn-kids-week').click().catch(() => undefined); await page.waitForTimeout(800); await snap('7-timeline-summary');
  return shots;
}

