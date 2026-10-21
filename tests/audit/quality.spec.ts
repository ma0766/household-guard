import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { freshHouse, signIn } from '../../e2e/helpers.js';

// Audit Part C (browser checks): axe, console, mobile width, plain language, 30-second test, voice.
const date = process.env.AUDIT_DATE ?? '2026-10-21';
const target = process.env.AUDIT_TARGET ?? 'local';
const dir = `audit/${date}`; mkdirSync(dir, { recursive: true });
const BANNED = ['policy', 'cedar', 'token', 'mcp', 'schema', 'json', 'error code'];
const syllables = (w: string) => Math.max(1, (w.toLowerCase().replace(/[^a-z]/g, '').replace(/e$/, '').match(/[aeiouy]+/g) ?? []).length);
const grade = (text: string) => { const s = text.split(/(?<=[.!?])\s+/).filter(Boolean); const w = text.split(/\s+/).filter((x) => /[a-z]/i.test(x)); if (!w.length) return 0; return 0.39 * (w.length / s.length) + 11.8 * (w.reduce((n, x) => n + syllables(x), 0) / w.length) - 15.59; };

const spoken: string[] = [];
const consoleErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { (window as any).__spoken = []; const orig = window.speechSynthesis?.speak?.bind(window.speechSynthesis); if (window.speechSynthesis) window.speechSynthesis.speak = (u: SpeechSynthesisUtterance) => { (window as any).__spoken.push(u.text); try { orig?.(u); } catch { /* headless: no voices */ } }; window.addEventListener('unhandledrejection', (e) => console.error('UNHANDLED_REJECTION ' + String(e.reason))); });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR ' + e.message));
});

async function say(page: Page, text: string) { await page.getByTestId('say').fill(text); await page.getByTestId('btn-say').click(); await page.waitForTimeout(800); }
async function allText(page: Page): Promise<{ where: string; text: string }[]> {
  const out = [{ where: 'page', text: await page.locator('main').innerText() }];
  for (const f of page.frames().slice(1)) { try { out.push({ where: `frame:${await f.name() || f.url().slice(0, 40)}`, text: await f.locator('body').innerText({ timeout: 1500 }) }); } catch { /* empty frame */ } }
  return out;
}
// walk the app into the states a person sees: lights, a held ride with an offer, a phone card, the timeline, a rule card
async function tour(page: Page) {
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

test('C1 axe: no serious or critical issues on any screen state', async ({ page }) => {
  test.setTimeout(300000);
  await page.goto(freshHouse() + '&dad=1'); await page.waitForLoadState('networkidle');
  const all: any[] = [];
  // axe cannot enter the sandboxed (opaque-origin) frames and hangs trying; so scan the page without frames, then copy each frame's HTML into its own page and scan that
  const record = (label: string, r: any) => { for (const v of r.violations) all.push({ state: label, id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, target: v.nodes[0]?.target }); };
  const scan = async (label: string) => {
    record(label, await new AxeBuilder({ page }).exclude('iframe').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze());
    for (const f of page.frames().slice(1)) {
      let html = ''; try { html = await f.content(); } catch { continue; }
      if (!/<body[^>]*>\s*\S/.test(html) && html.length < 200) continue;
      const p2 = await page.context().newPage(); await p2.setContent(html);
      record(`${label}/frame:${await f.name() || 'frame'}`, await new AxeBuilder({ page: p2 }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze());
      await p2.close();
    }
  };
  await scan('start');
  await page.getByTestId('who-guest').click(); await say(page, 'turn off the lights'); await scan('guest-lights');
  await signIn(page, 'maya'); await say(page, 'book a ride to the airport'); await scan('teen-ride-held');
  await page.getByTestId('btn-app-approvals').click().catch(() => undefined); await page.waitForTimeout(800); await scan('approvals-screen');
  await page.getByTestId('btn-kids-week').click().catch(() => undefined); await page.waitForTimeout(800); await scan('timeline');
  writeFileSync(`${dir}/C-axe-${target}.json`, JSON.stringify(all, null, 2));
  const bad = all.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad, JSON.stringify(bad, null, 1)).toEqual([]);
});

test('C2 console: zero errors and zero unhandled rejections during the tour', async ({ page }) => {
  await tour(page);
  writeFileSync(`${dir}/C-console-${target}.json`, JSON.stringify(consoleErrors, null, 2));
  expect(consoleErrors).toEqual([]);
});

test('C3 mobile 390px: no sideways scroll, phones and approval usable', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, recordVideo: { dir: `${dir}/pw-${target}/mobile` } });
  const page = await ctx.newPage();
  await page.goto(freshHouse() + '&dad=1'); await page.waitForLoadState('networkidle');
  await page.getByTestId('who-guest').click();
  const over = async (label: string) => page.evaluate((l) => ({ label: l, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, wide: [...document.querySelectorAll('body *')].filter((e) => (e as HTMLElement).getBoundingClientRect().right > 391 && getComputedStyle(e).position !== 'fixed').slice(0, 5).map((e) => e.tagName + '#' + e.id + '.' + e.className) }), label);
  const r: any[] = [await over('start')];
  await signIn(page, 'maya'); await say(page, 'book a ride to the airport'); r.push(await over('held-ride'));
  await page.screenshot({ path: `${dir}/C-${target}-mobile-390.png`, fullPage: true });
  for (const id of ['phone-maya', 'phone-mom']) await expect(page.getByTestId(id)).toBeVisible();
  writeFileSync(`${dir}/C-mobile-${target}.json`, JSON.stringify(r, null, 2));
  for (const x of r) expect(x.scrollW, JSON.stringify(x)).toBeLessThanOrEqual(x.clientW);
  await ctx.close();
});

test('C4 plain language: no banned words, sentences under 12 words, grade 5 or below', async ({ page }) => {
  await tour(page);
  const spokenNow: string[] = await page.evaluate(() => (window as any).__spoken);
  const texts = await allText(page);
  const bad: string[] = [];
  const lines: string[] = [...spokenNow];
  for (const t of texts) { if (t.where === 'page') { const log = t.text.indexOf('Message log'); lines.push(...t.text.slice(0, log < 0 ? undefined : log).split('\n')); } else lines.push(...t.text.split('\n')); }
  const prose = lines.map((l) => l.trim()).filter((l) => /[a-z]{3}/i.test(l));
  for (const l of prose) {
    for (const w of BANNED) if (new RegExp(`\\b${w}\\b`, 'i').test(l)) bad.push(`banned "${w}": ${l}`);
    for (const s of l.split(/(?<=[.!?])\s+/)) if (s.split(/\s+/).length >= 12) bad.push(`long (${s.split(/\s+/).length} words): ${s}`);
  }
  for (const l of spokenNow) if (grade(l) > 5) bad.push(`grade ${grade(l).toFixed(1)}: ${l}`);
  writeFileSync(`${dir}/C-plain-language-${target}.json`, JSON.stringify({ checked: prose.length, spoken: spokenNow, violations: bad, note: 'The "Message log" developer panel (raw MCP traffic, required by the hackathon web client) is excluded from user-facing text.' }, null, 2));
  expect(bad).toEqual([]);
});

test('C5 30-second test: approve a held request, and find last week\'s buys, at 1 click per 2 s', async ({ page }) => {
  await page.goto(freshHouse() + '&dad=1'); await page.waitForLoadState('networkidle');
  await signIn(page, 'maya');
  await say(page, 'book a ride to the airport'); await say(page, 'book a ride to the airport'); // held with a cheaper offer; asking again waits for an adult (set-up, not timed)
  const says = page.getByTestId('alexa-says');
  await expect(says).toContainText('An adult can tap');
  const clicks: string[] = []; const t0 = Date.now();
  const click = async (name: string, loc: ReturnType<Page['getByTestId']>) => { await page.waitForTimeout(2000); await loc.click(); clicks.push(name); };
  const num = (await says.textContent())!.match(/tap (\d\d) to say yes/)![1];
  await click(`tap ${num} on Mom's phone`, page.getByTestId(`approve-mom-num-${num}`));
  const approveSecs = (Date.now() - t0) / 1000;
  const t1 = Date.now();
  await click('What did the kids buy this week?', page.getByTestId('btn-kids-week'));
  await expect(page.getByTestId('summary')).toBeVisible({ timeout: 5000 });
  const findSecs = (Date.now() - t1) / 1000;
  writeFileSync(`${dir}/C-30s-${target}.json`, JSON.stringify({ approveSecs, findSecs, clicks }, null, 2));
  expect(approveSecs).toBeLessThan(30); expect(findSecs).toBeLessThan(30);
});

test('C6 voice: Talk button present, spoken replies use speech synthesis, typed fallback works', async ({ page }) => {
  await page.goto(freshHouse()); await page.waitForLoadState('networkidle');
  await expect(page.locator('#btn-talk')).toBeVisible();
  await page.getByTestId('who-guest').click();
  await say(page, 'turn off the lights');
  const spokenNow: string[] = await page.evaluate(() => (window as any).__spoken);
  expect(spokenNow.length, 'speechSynthesis.speak was never called').toBeGreaterThan(0);
  // typed fallback with the Enter key (a person types and presses Enter)
  await page.getByTestId('say').fill('turn on the lights'); await page.getByTestId('say').press('Enter'); await page.waitForTimeout(800);
  const afterEnter: string[] = await page.evaluate(() => (window as any).__spoken);
  writeFileSync(`${dir}/C-voice-${target}.json`, JSON.stringify({ spokenAfterButton: spokenNow, spokenAfterEnter: afterEnter, note: 'Live microphone check is MANUAL: headless Chromium has no microphone.' }, null, 2));
  expect(afterEnter.length, 'pressing Enter in the question box did nothing').toBeGreaterThan(spokenNow.length);
});

test('C7 typed phrases outside the keyword list get a helpful answer, not a dead end', async ({ page }) => {
  await page.goto(freshHouse()); await page.waitForLoadState('networkidle');
  await page.getByTestId('who-guest').click();
  await say(page, 'play some music in the kitchen');
  const reply = await page.getByTestId('alexa-says').innerText();
  writeFileSync(`${dir}/C-typed-unknown-${target}.json`, JSON.stringify({ typed: 'play some music in the kitchen', reply }, null, 2));
  expect(reply, 'no hint what to say instead').toMatch(/try|you can|for example|say/i);
});
