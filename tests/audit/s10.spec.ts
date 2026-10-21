import { test, expect, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freshHouse, signIn, confirmOnPhone, watchConsole } from './common';

// ---------- CI proof (CLI evidence; runs the same on both targets, it is repo-local) ----------

// Cedar: a forbid always beats a permit, so a stray permit alone is correctly NOT enough; the change that matters removes the guarding forbid too.
function mutate(dropIds: string[], extraAuto: string) {
  const dir = mkdtempSync(join(tmpdir(), 'au-s10m-'));
  for (const f of ['auto.cedar', 'approvable.cedar']) {
    const t = readFileSync(`src/policy/${f}`, 'utf8');
    const kept = t.split(/\n\s*\n/).filter((b) => !dropIds.some((id) => b.includes(`@id("${id}")`))).join('\n\n');
    writeFileSync(join(dir, f), kept + '\n' + (f === 'auto.cedar' ? extraAuto : '') + '\n');
  }
  return dir;
}

test.describe('S10 proofs (CLI)', () => {
  test.setTimeout(300000);
  const run = (args: string[]) => spawnSync('npm', ['run', '--silent', 'prove', '--', ...args], { encoding: 'utf8', timeout: 280000 });
  test('prove passes on the rules that ship', () => {
    const r = run([]);
    console.log(r.stdout + r.stderr);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/PROVEN {2}no child may unlock a door/);
    expect(r.stdout).toMatch(/Every promise is proven/);
  });
  test('prove: a stray permit alone does NOT break the promise (forbid beats permit) - control', () => {
    const dir = mkdtempSync(join(tmpdir(), 'au-s10-'));
    cpSync('src/policy/auto.cedar', join(dir, 'auto.cedar'));
    cpSync('src/policy/approvable.cedar', join(dir, 'approvable.cedar'));
    appendFileSync(join(dir, 'auto.cedar'), '\n@id("oops_children_unlock")\npermit(principal in Role::"child", action == Action::"unlock", resource);\n');
    const r = run(['--policies-dir', dir]);
    expect(r.status).toBe(0);
  });
  test('prove FAILS with a counterexample when a rule lets a child unlock', () => {
    const dir = mkdtempSync(join(tmpdir(), 'au-s10-'));
    cpSync('src/policy/auto.cedar', join(dir, 'auto.cedar'));
    cpSync('src/policy/approvable.cedar', join(dir, 'approvable.cedar'));
    const d2 = mutate(['adults_only_unlock', 'floor_children_no_unlock'], 'permit(principal in Role::"child", action == Action::"unlock", resource);');
    const r = run(['--policies-dir', d2]);
    console.log('EXIT', r.status, '\n' + r.stdout + r.stderr);
    writeFileSync('audit/2026-10-21/s10-prove-child-unlock-fail.log', `exit=${r.status}\n${r.stdout}${r.stderr}`);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/FAILED {2}no child may unlock a door/);
    expect(r.stdout).toMatch(/Role::"child"/);
    expect(r.stdout).toMatch(/unlock/);
  });
  test('prove FAILS when the safety rules are deleted (children can unlock via a plain allow)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'au-s10b-'));
    // remove every rule that mentions unlock, then allow it for everyone
    for (const f of ['auto.cedar', 'approvable.cedar']) {
      const t = readFileSync(`src/policy/${f}`, 'utf8');
      const kept = t.split(/\n\s*\n/).filter((b) => !/unlock/.test(b)).join('\n\n');
      writeFileSync(join(dir, f), kept + (f === 'auto.cedar' ? '\npermit(principal, action == Action::"unlock", resource);\n' : '\n'));
    }
    const r = run(['--policies-dir', dir]);
    writeFileSync('audit/2026-10-21/s10-prove-open-unlock-fail.log', `exit=${r.status}\n${r.stdout}${r.stderr}`);
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toMatch(/FAILED/);
  });
  test('prove FAILS when a guest may buy', () => {
    const d2 = mutate(['floor_guests_no_buy'], 'permit(principal in Role::"guest", action == Action::"purchase", resource);');
    const r = run(['--policies-dir', d2]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/FAILED {2}no guest may buy/);
  });
});

// ---------- Quiet hours through the UI ----------
const nyHour = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }).format(new Date())) % 24;
const utcHour = () => new Date().getUTCHours();

// Calls set_rule exactly as the page's rule card does (same MCP endpoint + the page's own key), for an hour window the buttons do not offer.
async function setQuiet(page: Page, from: number, to: number) {
  const out = await page.evaluate(async ({ from, to }) => {
    const hh = new URL(location.href).searchParams.get('hh')!;
    const t = await (await fetch(`/demo-token?hh=${hh}`)).json();
    const r = await fetch('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${t.token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/call', params: { name: 'set_rule', arguments: { template: 'quiet_hours', quiet_from_hour: from, quiet_to_hour: to } } }) });
    return (await r.json()).result?.structuredContent;
  }, { from, to });
  return out;
}

test('S10 rule card: quiet hours button shows a plain preview and the card', async ({ page }) => {
  const errs = watchConsole(page);
  await page.goto(freshHouse('s10a'));
  await signIn(page, 'mom');
  await page.getByTestId('rule-quiet-on').click();
  await expect(page.getByTestId('rule-preview')).toContainText(/\S/, { timeout: 15000 });
  const preview = await page.getByTestId('rule-preview').textContent();
  console.log('PREVIEW before tap:', preview);
  await confirmOnPhone(page, 'mom');
  const rules = page.frameLocator('[data-testid=rules-frame]');
  await expect(rules.locator('body'), 'rule card must show quiet hours ON').not.toContainText('Quiet hours are off', { timeout: 20000 });
  await expect(rules.locator('body')).toContainText(/9 PM/, { timeout: 5000 });
  console.log('RULES CARD:', (await rules.locator('body').innerText()).slice(0, 500));
  await page.screenshot({ path: 'audit/2026-10-21/s10-quiet-on.png' });
  // a teen cannot turn it off
  await signIn(page, 'maya');
  await page.getByTestId('rule-quiet-off').click();
  await expect(page.getByTestId('alexa-says')).not.toHaveText(/is confirmed\.|^Done\.$/, { timeout: 15000 });
  const said = await page.getByTestId('alexa-says').textContent();
  console.log('MAYA TRIES QUIET OFF ->', said);
  expect(said).not.toContain('Confirm on your phone'); // a teen must not be offered a confirm for changing rules
  expect(await page.getByTestId('alexa-says').getAttribute('data-outcome')).not.toBe('allowed');
  await expect(rules.locator('body')).not.toContainText('Quiet hours are off');
  console.log('console errors:', JSON.stringify([...new Set(errs)]));
});

test('S10 teen purchase inside quiet hours is held (house time zone), adult is exempt', async ({ page }) => {
  test.setTimeout(150000);
  page.on('response', async (r) => { if (/\/phone\/.*\/confirm/.test(r.url())) console.log('PHONE CONFIRM', r.status(), (await r.text().catch(() => '')).slice(0, 200)); });
  await page.goto(freshHouse('s10q'));
  const ny = nyHour();
  const utc = utcHour();
  console.log('NY hour', ny, 'UTC hour', utc);
  // 1) window that contains NOW in New York time. Local clock cannot be moved from a browser, so the window is moved to the clock instead of the clock to 9:30 PM.
  await signIn(page, 'mom');
  const r = await setQuiet(page, ny, (ny + 2) % 24);
  console.log('set_rule result:', JSON.stringify(r));
  expect(r?.status, 'set_rule answered with a phone check').toBe('waiting');
  await page.getByTestId(`phone-mom-num-${r.number}`).click();
  const rules = page.frameLocator('[data-testid=rules-frame]');
  await expect(rules.locator('body'), 'rule card must show quiet hours ON').not.toContainText('Quiet hours are off', { timeout: 20000 });
  console.log('RULES CARD:', (await rules.locator('body').innerText()).slice(0, 600));
  // 2) Mom (adult) is exempt: gets the normal phone check, not a quiet-hours stop
  await page.getByRole('button', { name: 'Book a ride to the mall' }).click();
  await expect(page.getByTestId('alexa-says')).not.toHaveText(/is confirmed\.|^Done\.$/, { timeout: 15000 });
  await expect(page.getByTestId('alexa-says')).toContainText(/Confirm on your phone|Booking|booked/i, { timeout: 15000 });
  console.log('MOM IN QUIET WINDOW SAYS:', await page.getByTestId('alexa-says').textContent());
  await confirmOnPhone(page, 'mom'); // finish her ride so the next speaker starts clean
  await expect(page.getByTestId('alexa-says')).toContainText(/Ride booked|booked|Done|on its way/i, { timeout: 60000 });
  console.log('MOM RIDE RESULT:', await page.getByTestId('alexa-says').textContent());
  // Maya asks for a cheap ride (mall) inside the window
  await signIn(page, 'maya');
  await page.getByRole('button', { name: 'Book a ride to the mall' }).click();
  await expect(page.getByTestId('alexa-says')).not.toHaveText(/is confirmed\.|^Done\.$/, { timeout: 15000 });
  await page.waitForTimeout(1500);
  const said = await page.getByTestId('alexa-says').textContent();
  console.log('MAYA IN QUIET WINDOW SAYS:', said, '| outcome', await page.getByTestId('alexa-says').getAttribute('data-outcome'));
  await page.screenshot({ path: 'audit/2026-10-21/s10-quiet-held.png' });
  expect(await page.getByTestId('alexa-says').getAttribute('data-outcome'), `Maya inside quiet hours: "${said}"`).not.toBe('allowed');
  expect(said!).toMatch(/quiet|night|late|9|hour|later|not now|asleep/i);
});

test('S10 time zone: a window that only matches UTC (not New York) must NOT hold', async ({ page }) => {
  test.setTimeout(150000);
  await page.goto(freshHouse('s10z'));
  const ny = nyHour();
  const utc = utcHour();
  test.skip(ny === utc, 'local clock zone equals New York zone: cannot tell zones apart on this target right now');
  await signIn(page, 'mom');
  const r = await setQuiet(page, utc, (utc + 1) % 24);
  expect(r?.status).toBe('waiting');
  await page.getByTestId(`phone-mom-num-${r.number}`).click();
  const rules = page.frameLocator('[data-testid=rules-frame]');
  await expect(rules.locator('body'), 'rule card must show quiet hours ON').not.toContainText('Quiet hours are off', { timeout: 20000 });
  await signIn(page, 'maya');
  await page.getByRole('button', { name: 'Book a ride to the mall' }).click();
  await expect(page.getByTestId('alexa-says')).not.toHaveText(/is confirmed\.|^Done\.$/, { timeout: 15000 });
  await expect(page.getByTestId('alexa-says')).toContainText(/Confirm on your phone|Held|Booking/i, { timeout: 15000 });
  const said = await page.getByTestId('alexa-says').textContent();
  console.log('MAYA (window only matches UTC) SAYS:', said);
  expect(said!, 'server read the hour in UTC, not the house zone').not.toMatch(/quiet|night/i);
});
