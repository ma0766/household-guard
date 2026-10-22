import { test, expect, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { freshHouse, signIn, confirmOnPhone } from './helpers.js';

// LEVEL UP: rule adding, typed rules, try it first, taps only for what matters, guests, private things, why?
// Screenshots for the README and the submission go to docs/screens/.
const rulesFrame = (page: Page) => page.frameLocator('[data-testid="rules-frame"]');
const say = async (page: Page, text: string) => {
  await page.getByTestId('say').fill(text);
  await page.getByTestId('btn-say').click();
};
const SHOT = (name: string) => `docs/screens/${name}.png`;
const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

test('1 rule adding: Maya $20, then $50 replaces it, then back to $20 by undo; a $35+ ride holds', async ({ page }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');
  await signIn(page, 'mom');
  await expect(rulesFrame(page).getByText('Maya: $20 a week.')).toBeVisible();
  await page.getByTestId('rule-sentence').fill('Maya can spend 50 dollars a week');
  await page.getByTestId('rule-sentence-go').click();
  await expect(page.getByTestId('rule-readback')).toContainText('This lets Maya spend $30 more a week.');
  await confirmOnPhone(page, 'mom');
  await expect(rulesFrame(page).getByText('Maya: $50 a week.')).toBeVisible();
  await expect(rulesFrame(page).getByText(/Maya: \$/)).toHaveCount(1); // replaced, never a second limit
  await page.getByTestId('rule-undo').click();
  await expect(says).toContainText('Confirm on your phone:');
  await confirmOnPhone(page, 'mom');
  await expect(rulesFrame(page).getByText('Maya: $20 a week.')).toBeVisible();
  await expect(rulesFrame(page).getByText(/Maya: \$/)).toHaveCount(1);
  // with $20 set, a $38 ride is held for an adult
  await signIn(page, 'maya');
  await page.getByRole('button', { name: 'Book a ride to the airport' }).click();
  await expect(says).toContainText("Held: over Maya's $20 a week.");
});

test('2 typed rule: "Maya can spend 30 dollars a week" is read back, saved only after Mom confirms; an unclear one is a question', async ({ page }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');
  await signIn(page, 'mom');
  await page.getByTestId('rule-sentence').fill('Maya can spend 30 dollars a week');
  await page.getByTestId('rule-sentence-go').click();
  await expect(page.getByTestId('rule-readback')).toHaveText("Maya's limit goes from $20 to $30 a week. This lets Maya spend $10 more a week.");
  await expect(rulesFrame(page).getByText('Maya: $20 a week.')).toBeVisible(); // not saved yet
  await page.screenshot({ path: SHOT('typed-rule-read-back'), fullPage: true });
  await confirmOnPhone(page, 'mom');
  await expect(says).toHaveText("Maya's limit goes from $20 to $30 a week.");
  await expect(rulesFrame(page).getByText('Maya: $30 a week.')).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: SHOT('typed-rule-saved'), fullPage: true });
  await page.getByTestId('rule-sentence').fill('Maya can spend a lot');
  await page.getByTestId('rule-sentence-go').click();
  await expect(says).toHaveText('How many dollars a week for Maya?');
});

test('3 try it first: the last 7 days are asked again under the new rule, before anything is saved', async ({ page }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');
  await signIn(page, 'maya');
  await page.getByRole('button', { name: 'Book a ride to the airport' }).click(); // $38: held now
  await expect(says).toContainText("Held: over Maya's $20 a week.");
  await say(page, 'turn off the lights');
  await expect(says).toContainText('lights');
  await signIn(page, 'mom');
  await page.getByTestId('rule-sentence').fill('Maya can spend 50 dollars a week');
  await page.getByTestId('rule-sentence-go').click();
  await expect(page.getByTestId('rule-tryfirst')).toHaveText("With this rule, 1 of Maya's 2 requests would change.");
  await expect(page.getByTestId('rule-tryfirst-list')).toContainText('Maya asked for a $38 ride. Was held for an adult. Now done after a tap.');
  await expect(rulesFrame(page).getByText('Maya: $20 a week.')).toBeVisible(); // looking is not saving
  await page.screenshot({ path: SHOT('try-it-first'), fullPage: true });
  await confirmOnPhone(page, 'mom');
  await expect(rulesFrame(page).getByText('Maya: $50 a week.')).toBeVisible();
});

test('4 taps only for what matters: no tap for everyday things and the garage; a tap for a buy (then 5 minutes covered) and a door', async ({ page }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');
  await signIn(page, 'maya');
  await say(page, 'open the garage');
  await expect(says).toHaveText('Heads up. The garage is opening.');
  await signIn(page, 'mom');
  for (const [ask, want] of [['turn off the lights', /lights/], ['play some jazz', /Playing jazz/], ["what's the weather", /72 degrees/], ['set a timer for 5 minutes', /Timer set for 5 minutes/]] as const) {
    await say(page, ask);
    await expect(says).toHaveText(want);
    await expect(says).not.toContainText('Confirm on your phone');
  }
  // a buy needs a tap...
  await say(page, 'book a ride to the mall');
  await expect(says).toContainText('Confirm on your phone:');
  await confirmOnPhone(page, 'mom');
  await expect(says).toContainText('Your ride is booked.');
  // ...and that one tap covers her next buy (inside her limits) for 5 minutes
  await say(page, 'book a ride to the mall');
  await expect(says).toHaveText(/Booking it now|Your ride is booked/);
  await expect(says).not.toContainText('Confirm on your phone');
  // a door always asks
  await say(page, 'unlock the front door');
  await expect(says).toContainText('Confirm on your phone:');
});

test('5 guests: the switch, a named guest with their own PIN and list, and what guests never do', async ({ page }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');
  // anyone at home can do everyday things by default
  await page.getByTestId('who-guest').click();
  await say(page, 'turn off the lights');
  await expect(says).toHaveText(/lights/);
  await expect(says).toHaveAttribute('data-outcome', 'allowed');
  // Mom turns the switch off
  await signIn(page, 'mom');
  await page.getByTestId('guest-switch').uncheck();
  await confirmOnPhone(page, 'mom');
  await expect(rulesFrame(page).getByText('Everyday things need a PIN or a tap.')).toBeVisible();
  await page.getByTestId('who-guest').click();
  await say(page, 'turn off the lights');
  await expect(says).toHaveText('Tell me who you are first. Say your PIN or tap your phone.');
  await page.waitForTimeout(500);
  await page.screenshot({ path: SHOT('guest-switch'), fullPage: true });
});

test('5b named guest: own PIN (shown on Mom\'s phone only), own list, an end date; guests never spend, unlock, change rules or hear orders', async ({ page }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');
  await signIn(page, 'mom');
  // own list, last day in three days. His PIN shows on her phone only.
  await page.getByTestId('guest-name').fill('Sam');
  await page.getByTestId('guest-until').fill(day(3));
  await page.getByTestId('guest-add').click();
  await confirmOnPhone(page, 'mom'); // lights and music are ticked
  const secret = page.getByTestId('phone-secret-mom');
  await expect(secret).toContainText('Their PIN is');
  const pin = (await secret.textContent())!.match(/PIN is (\d{4})/)![1];
  await expect(page.getByTestId('alexa-says')).not.toContainText(pin); // never said by Alexa
  await expect(rulesFrame(page).getByText(/Guest Sam: light, music/)).toBeVisible();
  // Sam says who he is, does his list, and nothing else
  await page.getByTestId('who-guest').click();
  await say(page, `I'm Sam, my PIN is ${pin}`);
  await expect(says).toHaveText('Hi Sam.');
  await say(page, 'turn off the lights');
  await expect(says).toHaveAttribute('data-outcome', 'allowed');
  await say(page, 'set the thermostat to 72');
  await expect(says).toHaveAttribute('data-outcome', 'denied');
  for (const ask of ['unlock the front door', 'open the garage', 'book a ride to the mall', 'what did we order']) {
    await say(page, ask);
    await expect(says).toHaveAttribute('data-outcome', 'denied');
  }
  await say(page, 'Sam can spend 500 dollars a week');
  await expect(says).toHaveText('Ask an adult to change rules.');
  expect(await page.locator('body').innerText()).not.toMatch(/lego|castle|soccer/i);
  await page.screenshot({ path: SHOT('named-guest'), fullPage: true });
});

test('6 private things: Leo asks "what did we order" and hears nothing about the gift; Mom marks one more as a gift', async ({ page }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');
  await page.getByTestId('who-leo').click();
  await page.getByTestId('pin').fill('4821');
  await page.getByTestId('btn-pin').click();
  await expect(says).toHaveText('Hi Leo.');
  await say(page, 'what did we order?');
  await expect(says).toHaveText("That's private. Ask a grown-up.");
  await page.waitForTimeout(2500);
  expect(await page.locator('body').innerText()).not.toMatch(/lego|castle|soccer|paper towels|charger/i);
  await page.screenshot({ path: SHOT('leo-private'), fullPage: true });
  await signIn(page, 'mom');
  await say(page, 'what did we order?');
  await expect(says).toContainText('Lego castle (a gift for Leo)');
  await say(page, 'mark the phone charger as a gift for Maya');
  await expect(says).toHaveText('Okay. It is marked as a gift. Only adults hear it.');
  await say(page, 'what did we order?');
  await expect(says).toContainText('phone charger (a gift for Maya)');
  await page.getByTestId('who-leo').click();
  await page.getByTestId('pin').fill('4821');
  await page.getByTestId('btn-pin').click();
  await say(page, 'what did we order?');
  await expect(says).toHaveText("That's private. Ask a grown-up.");
});

test('7 why: every answer and every card can say which rule decided, in one sentence', async ({ page }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');
  await signIn(page, 'maya');
  await page.getByRole('button', { name: 'Book a ride to the airport' }).click();
  await expect(says).toContainText("Held: over Maya's $20 a week.");
  await page.getByTestId('btn-why').click();
  await expect(says).toHaveText("Because of this rule: Maya's $20 a week.");
  await say(page, 'unlock the front door');
  await say(page, 'why?');
  await expect(says).toHaveText(/^Because of this rule: (children can't unlock doors|only adults unlock doors)\.$/);
  // the card on Mom's phone has a Why? too
  await page.getByTestId('why-mom').click();
  await expect(page.getByTestId('why-text-mom')).toHaveText("Because of this rule: Maya's $20 a week.");
  await page.screenshot({ path: SHOT('why'), fullPage: true });
  // and the timeline names the rule
  await expect(page.frameLocator('[data-testid=timeline]').locator('body')).toContainText("Rule: Maya's $20 a week.", { timeout: 10000 });
});

test('4b no-tap list (off by default): Mom lets Maya buy small things with no tap', async ({ page }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');
  await signIn(page, 'mom');
  await page.getByTestId('notap-save').click(); // Maya, up to $10
  await expect(page.getByTestId('rule-tryfirst')).toContainText('requests');
  await expect(says).toContainText('Confirm on your phone:');
  await confirmOnPhone(page, 'mom');
  await expect(rulesFrame(page).getByText('Maya buys up to $10 with no tap.')).toBeVisible();
  await signIn(page, 'maya');
  await say(page, 'book a shared ride to the school');
  await expect(says).not.toContainText('Confirm on your phone');
});

test('8 README: "Where the code is" links the MCP server, the decision engine and the tests, and every link opens a real file', async () => {
  const readme = readFileSync('README.md', 'utf8');
  const section = readme.split('## Where the code is')[1]?.split('\n## ')[0] ?? '';
  for (const must of ['src/mcp/server.ts', 'src/core/request-action.ts', 'src/policy/rules.ts', 'tests/s20', 'tests/replay/cases.ts']) expect(section, must).toContain(must);
  const paths = [...section.matchAll(/\]\(([^)#]+)\)/g)].map((m) => m[1]);
  expect(paths.length).toBeGreaterThan(20);
  for (const p of paths) expect(existsSync(p), p).toBe(true);
});
