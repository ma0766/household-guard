import { readFileSync, existsSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

export const freshHouse = (p = 'au') => `/?hh=${p}${Date.now()}${Math.floor(Math.random() * 1e6)}`;
export const target = process.env.AUDIT_TARGET ?? 'local';

// Base URL of the roadmap stage (read from the env file in-process; nothing else is read or printed).
export function roadmapUrl(): string | undefined {
  if (!existsSync('.env.deploy.roadmap')) return undefined;
  const l = readFileSync('.env.deploy.roadmap', 'utf8').split('\n').find((x) => x.startsWith('HG_URL='));
  return l ? l.slice('HG_URL='.length).trim().replace(/\/$/, '') : undefined;
}

export async function confirmOnPhone(page: Page, who: string) {
  const says = page.getByTestId('alexa-says');
  await expect(says).toContainText('Confirm on your phone:', { timeout: 15000 });
  const n = (await says.textContent())!.match(/(\d\d)\s*$/)![1];
  await page.getByTestId(`phone-${who}-num-${n}`).click();
}
export async function signIn(page: Page, who: string) {
  await page.getByTestId(`who-${who}`).click();
  await confirmOnPhone(page, who);
  await expect(page.getByTestId('alexa-says')).toContainText(/are confirmed|^Done\.$/, { timeout: 15000 });
  await page.waitForTimeout(1500); // the page's own job poll may replace the line with "Done." a moment later
}
// collect console errors / page errors so UX problems are reported
export function watchConsole(page: Page) {
  const errs: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e)));
  return errs;
}

export const STALE = /are confirmed\.|^Done\.$/; // lines that are left over from signing in
