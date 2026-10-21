import { test, expect } from '@playwright/test';
import { fresh, signIn, tapNumber, STANDIN_WORDS, watchConsole } from './helpers';
import { readFileSync, writeFileSync } from 'node:fs';

// S15 "Done when": "Build a one-page site for my bakery" returns a published preview within the job.
test.describe('S15 long jobs + site building', () => {
  test('Mom taps -> job runs -> preview link + code -> preview page opens; teen held; guest denied', async ({ page, context }) => {
    const errs = watchConsole(page);
    await page.goto(fresh());
    const says = page.getByTestId('alexa-says');
    // teen: held, nothing built
    await signIn(page, 'maya');
    await page.getByTestId('btn-build-site').click();
    await page.waitForTimeout(2500);
    const teenText = (await says.textContent())!;
    await page.screenshot({ path: 'audit/2026-10-21/A-s15-01-teen.png' });
    expect(teenText).not.toMatch(/ready|published|built/i);
    // guest: denied
    await page.getByTestId('who-guest').click();
    await page.getByTestId('btn-build-site').click();
    await page.waitForTimeout(2500);
    const guestText = (await says.textContent())!;
    await page.screenshot({ path: 'audit/2026-10-21/A-s15-02-guest.png' });
    expect(guestText).not.toMatch(/ready|published/i);
    // Mom: asks, answer comes at once with a wait-for-tap, taps, job runs
    await signIn(page, 'mom');
    const t0 = Date.now();
    await page.getByTestId('btn-build-site').click();
    await expect(says).toContainText('Confirm on your phone:');
    const answerMs = Date.now() - t0;
    await tapNumber(page, 'mom');
    const frame = page.frameLocator('[data-testid=app-frame]');
    const seen: string[] = [];
    const watcher = setInterval(async () => { try { const s = await says.textContent(); if (s && seen[seen.length - 1] !== s) seen.push(s); } catch {} }, 300);
    await expect(frame.getByTestId('app-link')).toBeVisible({ timeout: 45000 });
    clearInterval(watcher);
    await expect(frame.getByTestId('app-qr')).toBeVisible();
    const link = (await frame.getByTestId('app-link').textContent())!.trim();
    const screenText = await frame.locator('body').innerText();
    await page.screenshot({ path: 'audit/2026-10-21/A-s15-03-ready.png' });
    const p2 = await context.newPage();
    const resp = await p2.goto(link);
    expect(resp!.status()).toBe(200);
    const previewText = await p2.locator('body').innerText();
    await p2.screenshot({ path: 'audit/2026-10-21/A-s15-04-preview-page.png' });
    expect(previewText).toMatch(/bakery/i);
    writeFileSync('audit/2026-10-21/A-s15-texts.json', JSON.stringify({ teenText, guestText, seen, screenText, previewText, link, answerMs, errs }, null, 2));
    expect.soft(errs, 'console errors').toEqual([]);
  });

  test('stand-in site builder is CLEARLY LABELLED to a judge (UI button/panel)', async ({ page }) => {
    await page.goto(fresh());
    const panel = await page.locator('#apps-panel').innerText();
    expect(panel, `Apps panel text: ${JSON.stringify(panel)}`).toMatch(STANDIN_WORDS);
  });

  test('stand-in site builder is labelled on the finished screen and the preview page', async ({ page, context }) => {
    await page.goto(fresh());
    await signIn(page, 'mom');
    await page.getByTestId('btn-build-site').click();
    await tapNumber(page, 'mom');
    const frame = page.frameLocator('[data-testid=app-frame]');
    await expect(frame.getByTestId('app-link')).toBeVisible({ timeout: 45000 });
    const screenText = await frame.locator('body').innerText();
    const link = (await frame.getByTestId('app-link').textContent())!.trim();
    const p2 = await context.newPage(); await p2.goto(link);
    const prev = await p2.locator('body').innerText();
    expect(screenText + '\n' + prev, `ready screen: ${JSON.stringify(screenText)} | preview: ${JSON.stringify(prev)}`).toMatch(STANDIN_WORDS);
  });

  test('README labels the site builder (Wix) as a stand-in', async () => {
    const m = readFileSync('README.md', 'utf8').match(/.*Wix.*/g) ?? [];
    expect(m.join('\n')).toMatch(/stand-?in/i);
  });
});
