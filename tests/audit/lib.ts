import { expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { Store } from '../../src/core/store.js';
import { localClient } from '../../src/core/local-dynamo.js';
import { setRideState } from '../../src/connectors/mock-ride.js';

export const isProd = () => (process.env.AUDIT_TARGET ?? 'local') === 'prod';
export const newHh = (tag: string) => `au${tag}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
// Setup/tamper side door only (the UI has no button for these): local DynamoDB on 8018, or the prod table via AWS credentials from the environment.
export const store = () => (isProd() ? new Store(new DynamoDBClient({ region: 'us-east-1' })) : new Store(localClient()));
export const rideState = (hh: string, s: Record<string, unknown>) => setRideState(store(), hh, s as never);
export const auditKey = (hh: string, seq: number) => ({ pk: Store.hk(hh), sk: `AUDIT#${String(seq).padStart(10, '0')}` });
export function verifyCli(hh: string): { code: number; out: string } {
  const args = ['tsx', 'scripts/verify-audit.ts', hh, ...(isProd() ? [] : ['--local'])];
  try { return { code: 0, out: execFileSync('npx', args, { encoding: 'utf8' }) }; }
  catch (e: any) { return { code: e.status ?? 1, out: String(e.stdout ?? '') + String(e.stderr ?? '') }; }
}

export async function open(page: Page, hh: string) {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  // the demo sign-in is limited to 20 per minute per caller (other auditors share this machine): retry after a pause, and say so
  for (let i = 0; ; i++) {
    await page.goto(`/?hh=${hh}`);
    await page.getByRole('button', { name: 'Connect', exact: true }).click(); // opens the connection + seeds the house
    try { await expect(page.getByTestId('log')).toContainText('"result"', { timeout: 10000 }); break; }
    catch (e) { if (i >= 3) throw e; await page.waitForTimeout(20000); }
  }
  return errors;
}
export const alexa = (page: Page) => page.getByTestId('alexa-says');
export async function confirmOnPhone(page: Page, who: string) {
  await expect(alexa(page)).toContainText('Confirm on your phone:', { timeout: 15000 });
  const n = (await alexa(page).textContent())!.match(/(\d\d)\s*$/)![1];
  await page.getByTestId(`phone-${who}-num-${n}`).click();
}
export async function signIn(page: Page, who: 'mom' | 'maya') {
  await page.getByTestId(`who-${who}`).click();
  await confirmOnPhone(page, who);
  await expect(alexa(page)).toContainText(/is confirmed|^Done\./, { timeout: 15000 }) // prod sometimes shows a bare "Done." here (UX finding);
}
export const ask = async (page: Page, text: string) => { await page.getByTestId('say').fill(text); await page.getByTestId('btn-say').click(); };
export const frameText = (page: Page, testid: string) => page.frameLocator(`[data-testid="${testid}"]`).locator('body');
