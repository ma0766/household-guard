import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { confirmOnPhone, signIn } from '../../e2e/helpers.js';
const signInAs = async (page: Page, who: string) => { if (who === 'dad') { await page.getByTestId('who-dad').click(); await confirmOnPhone(page, 'dad' as any); await expect(page.getByTestId('alexa-says')).toContainText('are confirmed'); } else await signIn(page, who as any); };

// Audit Part B: the 2:45 demo script from docs/SPEC.md, in ONE recorded Chromium session at 1920x1080,
// on npm run demo:reset data (household "demo": Mom, Dad, Maya 15, Leo 8, a guest). Run once per target.
const date = process.env.AUDIT_DATE ?? '2026-10-21';
const target = process.env.AUDIT_TARGET ?? 'local';
const dir = `audit/${date}`; mkdirSync(dir, { recursive: true });
const PAUSE = 1500; // a natural beat between a person's actions
const consoleErrors: string[] = []; const slow: string[] = []; const segs: { seg: string; window: string; seconds: number; note?: string }[] = [];

test.use({ trace: 'off' }); // the recorder's own script in the sandboxed frames would add fake console errors to the take
test('B: the 2:45 demo, start to finish', async ({ browser }) => {
  test.setTimeout(400000);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: `${dir}/pw-${target}/demo`, size: { width: 1920, height: 1080 } } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR ' + e.message));
  const says = page.getByTestId('alexa-says');
  const beat = () => page.waitForTimeout(PAUSE);
  // after a tap, wait until the old "Confirm on your phone: NN" line is gone, else the next sign-in reads a stale number (slow networks, like prod)
  const settle = () => expect(says).not.toContainText('Confirm on your phone', { timeout: 20000 });
  // click + time how long until Alexa's line changes (reply time a viewer feels)
  const ask = async (label: string) => { console.log(`[demo]   ask ${label} (says now: ${JSON.stringify(await says.textContent())})`); const before = await says.textContent(); const t = Date.now(); await page.getByRole('button', { name: label, exact: true }).click(); await expect(says).not.toHaveText(before ?? '', { timeout: 15000 }).catch(() => undefined); const ms = Date.now() - t; if (ms > 1000) slow.push(`"${label}" took ${ms} ms to answer`); await beat(); return (await says.textContent()) ?? ''; };
  const seg = async (name: string, window: string, fn: () => Promise<string | void>) => { const t = Date.now(); console.log(`[demo] start ${name}`); const note = await fn(); segs.push({ seg: name, window, seconds: +((Date.now() - t) / 1000).toFixed(1), note: note || undefined }); };
  const T0 = Date.now();

  await page.goto(`/?dad=1${process.env.AUDIT_DEMO_HH ? `&hh=${process.env.AUDIT_DEMO_HH}` : ''}`); await page.waitForLoadState('networkidle'); // household "demo" (on prod: a separate demo house made by the same reset)
  await seg('1 hook: teen $38 ride held, parent card pops up', '0:00-0:20', async () => {
    await signIn(page, 'maya'); await beat();
    const r = await ask('Book a ride to the airport');
    await expect(page.getByTestId('approval-mom')).toBeVisible();
    await beat(); await page.screenshot({ path: `${dir}/B-${target}-1-hook.png` });
    return r;
  });
  await seg('2 the problem (a slide in the real video; not in the app)', '0:20-0:45', async () => { await page.getByRole('heading', { name: 'Household Guard' }).scrollIntoViewIfNeeded(); await page.waitForTimeout(3000); return 'No slide exists in the app; time here is a 3 s placeholder, narration needs ~25 s'; });
  await seg('3 three speakers, the same three requests', '0:45-1:30', async () => {
    const out: string[] = [];
    for (const who of ['guest', 'maya', 'mom'] as const) {
      if (who === 'guest') await page.getByTestId('who-guest').click(); else await signIn(page, who);
      await beat();
      out.push(`${who}: lights → ${await ask('Turn off the lights')}`);
      const tapIfAsked = async () => { if (who !== 'guest' && /Confirm on your phone/.test((await says.textContent()) ?? '')) { await confirmOnPhone(page, who as any); await settle(); await beat(); out.push(`   (tapped) → ${await says.textContent()}`); } };
      out.push(`${who}: unlock → ${await ask('Unlock the front door')}`); await tapIfAsked();
      out.push(`${who}: ride → ${await ask('Book a ride to the airport')}`); await tapIfAsked();
      if (who === 'maya') { await page.getByTestId('accept-alt').click().catch(() => undefined); await beat(); await confirmOnPhone(page, 'maya').catch(() => undefined); await settle().catch(() => undefined); await beat(); }
    }
    await page.screenshot({ path: `${dir}/B-${target}-3-speakers.png` });
    return out.join(' | ');
  });
  await seg('4 gift card: allowed by the rules, held by the AI check', '1:30-1:50', async () => {
    await signInAs(page, 'dad'); await beat(); // Mom has used her 3 phone taps in step 3
    const r = await ask('Buy a gift card');
     // mom → phone confirm then the worker's risk check
    await confirmOnPhone(page, 'dad' as any).catch(() => undefined); await settle().catch(() => undefined); await page.waitForTimeout(1500);
    await page.screenshot({ path: `${dir}/B-${target}-4-giftcard.png` });
    return `${r} → after tap: ${await says.textContent()}`;
  });
  await seg('5 self-healing: break, check, repaired, next ride needs one yes', '1:50-2:15', async () => {
    await page.getByTestId('btn-break-ride').click(); await beat(); // Dad is the confirmed adult
    await ask('Book a ride to the mall');
    await page.getByTestId('btn-check-rides').click(); await expect(says).toContainText('We fixed it.', { timeout: 30000 }); await beat();
    const held = await ask('Book a ride to the mall');
    const n = held.match(/tap (\d\d) to say yes/)?.[1]; if (n) { await page.getByTestId(`approve-mom-num-${n}`).click(); await beat(); }
    await page.screenshot({ path: `${dir}/B-${target}-5-healing.png` });
    return `${held} -> ${await says.textContent()}`;
  });
  await seg('6 audit timeline + proof', '2:15-2:35', async () => {
    await page.getByTestId('timeline').scrollIntoViewIfNeeded(); await beat();
    await page.getByTestId('btn-kids-week').click(); await expect(page.getByTestId('summary')).toBeVisible({ timeout: 8000 }); await beat();
    await page.screenshot({ path: `${dir}/B-${target}-6-audit.png` });
    return 'The "30/30 replay passing" shot is a terminal capture (see tests/replay output), not part of the web page';
  });
  await seg('7 architecture diagram', '2:35-2:45', async () => { const p2 = await ctx.newPage(); await p2.goto('file://' + process.cwd() + '/docs/architecture.svg'); await p2.waitForTimeout(3000); await p2.screenshot({ path: `${dir}/B-${target}-7-architecture.png` }); await p2.close(); });

  const total = (Date.now() - T0) / 1000;
  await ctx.close();
  const vid = await page.video()?.path();
  if (vid && target === 'local') renameSync(vid, `${dir}/demo-run.webm`);
  else if (vid) renameSync(vid, `${dir}/demo-run-${target}.webm`);
  writeFileSync(`${dir}/B-demo-timing-${target}.json`, JSON.stringify({ totalSeconds: +total.toFixed(1), totalMmSs: `${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, '0')}`, budget: '2:45', segments: segs, slowMoments: slow, consoleErrors }, null, 2));
  expect(total).toBeLessThan(165);
  expect(consoleErrors).toEqual([]);
});
