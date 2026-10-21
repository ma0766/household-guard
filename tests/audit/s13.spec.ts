import { test, expect } from '@playwright/test';
import { fresh, signIn, tapNumber, STANDIN_WORDS, watchConsole } from './helpers.js';
import { readFileSync, writeFileSync } from 'node:fs';

// S13 "Done when": a teen connects a music app; her token is separate from Mom's. Driven like a person.
test.describe('S13 connect any app, per person', () => {
  test('teen connects an app: held until an adult allows, then Maya connects, Mom stays unconnected', async ({ page, context }) => {
    const errs = watchConsole(page);
    await page.goto(fresh());
    // 1. Maya asks to play jazz before any adult allowed the app -> must NOT be played
    await signIn(page, 'maya');
    const says = page.getByTestId('alexa-says');
    const before1 = (await says.textContent())!;
    await page.getByTestId('btn-play-jazz').click();
    await expect(says).not.toHaveText(before1, { timeout: 10000 });
    const heldText = (await says.textContent())!;
    expect(heldText, 'a new app must be held for an adult, not played').not.toMatch(/^Done|playing/i);
    expect(heldText).toMatch(/adult|yes|ask/i);
    await page.screenshot({ path: 'audit/2026-10-21/A-s13-01-maya-held.png' });
    // 2. Mom allows Spotify with her own tap
    await signIn(page, 'mom');
    await page.getByTestId('btn-allow-spotify').click();
    await tapNumber(page, 'mom');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'audit/2026-10-21/A-s13-02-mom-allowed.png' });
    // 3. Maya connects (own phone tap) -> a link + code on screen
    await signIn(page, 'maya');
    await page.getByTestId('btn-connect-spotify').click();
    const frame = page.frameLocator('[data-testid=app-frame]');
    await expect(frame.getByTestId('app-link')).toBeVisible({ timeout: 15000 });
    await expect(frame.getByTestId('app-qr')).toBeVisible();
    const link = (await frame.getByTestId('app-link').textContent())!.trim();
    await page.screenshot({ path: 'audit/2026-10-21/A-s13-03-connect-screen.png' });
    // 4. open the app's own sign-in page and press Allow
    // FINDING CHECK: the link/QR a person scans must open on this server, not a made-up host
    expect.soft(new URL(link).origin, 'link shown on the connect screen must open the running server').toBe(new URL(page.url()).origin);
    const p2 = await context.newPage();
    await p2.goto(new URL(new URL(link).pathname, page.url()).toString()); // continue the flow on the real host so later steps are still tested
    const standinBody = await p2.locator('body').innerText();
    await p2.getByTestId('standin-allow').click();
    await expect(p2.getByTestId('standin-out')).toContainText('Connected');
    await p2.screenshot({ path: 'audit/2026-10-21/A-s13-04-standin-page.png' });
    // 5. Maya can now play; Mom (not connected) cannot
    const beforePlay = (await says.textContent())!;
    await page.getByTestId('btn-play-jazz').click();
    await expect(says).not.toHaveText(beforePlay, { timeout: 10000 });
    const mayaText = (await says.textContent())!;
    await page.screenshot({ path: 'audit/2026-10-21/A-s13-05-maya-plays.png' });
    expect(mayaText).not.toMatch(/connect/i); // she is connected: should not ask her to connect again
    await signIn(page, 'mom');
    await page.getByTestId('btn-play-jazz').click();
    await page.waitForTimeout(2000);
    const momText = (await says.textContent())!;
    await page.screenshot({ path: 'audit/2026-10-21/A-s13-06-mom-not-connected.png' });
    expect(momText, 'Mom must not ride on Maya connection').toMatch(/connect/i);
    // 6. a guest is refused
    await page.getByTestId('who-guest').click();
    await page.getByTestId('btn-play-jazz').click();
    await page.waitForTimeout(1500);
    const guestText = (await says.textContent())!;
    expect(guestText).not.toMatch(/playing/i);
    // record wording + labelling evidence
    const notes = { heldText, mayaText, momText, guestText, standinBody, link, errs };
    writeFileSync('audit/2026-10-21/A-s13-texts.json', JSON.stringify(notes, null, 2));
    expect.soft(errs, 'console errors').toEqual([]);
  });

  test('stand-in hub is CLEARLY LABELLED to a judge in the UI', async ({ page }) => {
    await page.goto(fresh());
    await signIn(page, 'maya');
    // the Apps panel is what a judge sees before clicking anything
    const appsPanel = await page.locator('#apps-panel').innerText();
    await page.locator('#apps-panel').screenshot({ path: 'audit/2026-10-21/A-s13-label-apps-panel.png' });
    expect(appsPanel, `Apps panel text was: ${JSON.stringify(appsPanel)}`).toMatch(STANDIN_WORDS);
  });

  test('stand-in hub is labelled on the app sign-in page and connect screen', async ({ page, context }) => {
    await page.goto(fresh());
    await signIn(page, 'mom');
    await page.getByTestId('btn-allow-spotify').click(); await tapNumber(page, 'mom');
    await page.waitForTimeout(1500);
    await signIn(page, 'maya');
    await page.getByTestId('btn-connect-spotify').click();
    const frame = page.frameLocator('[data-testid=app-frame]');
    await expect(frame.getByTestId('app-link')).toBeVisible({ timeout: 15000 });
    const screenText = await frame.locator('body').innerText();
    const link = (await frame.getByTestId('app-link').textContent())!.trim();
    const p2 = await context.newPage(); await p2.goto(new URL(new URL(link).pathname, page.url()).toString());
    const standin = await p2.locator('body').innerText();
    expect(screenText + '\n' + standin, `connect screen: ${JSON.stringify(screenText)} | app page: ${JSON.stringify(standin)}`).toMatch(STANDIN_WORDS);
  });

  test('the app sign-in page itself says it is a stand-in (not only the URL host)', async ({ page, context }) => {
    await page.goto(fresh());
    await signIn(page, 'mom');
    await page.getByTestId('btn-allow-spotify').click(); await tapNumber(page, 'mom');
    await page.waitForTimeout(1500);
    await signIn(page, 'maya');
    await page.getByTestId('btn-connect-spotify').click();
    const frame = page.frameLocator('[data-testid=app-frame]');
    await expect(frame.getByTestId('app-link')).toBeVisible({ timeout: 15000 });
    const link = (await frame.getByTestId('app-link').textContent())!.trim();
    const p2 = await context.newPage(); await p2.goto(new URL(new URL(link).pathname, page.url()).toString());
    const body = await p2.locator('body').innerText();
    expect(body, `app page text: ${JSON.stringify(body)}`).toMatch(STANDIN_WORDS);
  });

  test('README labels the app hub (Composio) as a stand-in', async () => {
    const readme = readFileSync('README.md', 'utf8');
    const m = readme.match(/.*Composio.*/g) ?? [];
    expect(m.join('\n')).toMatch(/stand-?in/i);
  });
});
