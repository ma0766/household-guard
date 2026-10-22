import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { freshHouse, signIn, confirmOnPhone } from './helpers.js';

// KINDS: a new device is safe by default, the scam guard, visitors, projects. Screenshots go to docs/screens/.
const SHOT = (name: string) => `docs/screens/${name}.png`;
const KEY = 'sk-demo-vacuum-9f3a77';
const say = async (page: Page, text: string) => {
  await page.getByTestId('say').fill(text);
  await page.getByTestId('btn-say').click();
};
const houseOf = (url: string) => new URL(url, 'http://x').searchParams.get('hh')!;

// Mom adds the robot vacuum: the key is typed on HER phone, and only there.
async function addVacuum(page: Page) {
  await signIn(page, 'mom');
  await say(page, 'connect my new robot vacuum');
  const says = page.getByTestId('alexa-says');
  await expect(says).toContainText('Finish on your phone. Type the key there.');
  expect(await page.locator('body').innerText()).not.toContain(KEY);
  await page.getByTestId('phone-mom-key').fill(KEY);
  await confirmOnPhone(page, 'mom');
  await expect(says).toContainText('The robot vacuum is added.');
}

test('2 device: Mom adds the robot vacuum (key typed on her phone only); Leo starts it', async ({ page }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');
  await addVacuum(page);
  await expect(says).toContainText('Want the hallway camera to check on it? Off until you say yes.');
  expect(await page.locator('body').innerText()).not.toContain(KEY); // not on the page, not in the log
  await page.screenshot({ path: SHOT('device-added'), fullPage: true });
  await page.getByTestId('who-leo').click();
  await page.getByTestId('pin').fill('4821');
  await page.getByTestId('btn-pin').click();
  await say(page, 'start the vacuum');
  await expect(says).toHaveText('Okay. The vacuum is cleaning.');
  await expect(says).toHaveAttribute('data-outcome', 'allowed');
  await page.screenshot({ path: SHOT('leo-starts-vacuum'), fullPage: true });
});

test('2 device: a teen cannot add a device, and no card reaches an adult', async ({ page }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');
  await signIn(page, 'maya');
  await say(page, 'connect my new robot vacuum');
  await expect(says).toHaveText('Only adults can do that.');
  await expect(says).toHaveAttribute('data-outcome', 'denied');
  await expect(page.getByTestId('phone-mom')).not.toContainText(/key|vacuum/i);
  await page.screenshot({ path: SHOT('teen-cannot-add-device'), fullPage: true }); // the refusal to add a device, with nothing on Mom's phone
  await say(page, 'show the hallway camera'); // a teen is refused the camera too
  await expect(says).toHaveAttribute('data-outcome', 'denied');
  await page.screenshot({ path: SHOT('teen-refused-camera'), fullPage: true });
});

test('2 camera: suggested once, off until an adult says Yes; a guest is refused it', async ({ page }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');
  await addVacuum(page);
  const card = page.getByTestId('suggestion-mom');
  await expect(card).toContainText('Want the hallway camera to check on it? Off until you say yes.');
  await page.screenshot({ path: SHOT('camera-suggestion'), fullPage: true });
  await say(page, 'show the hallway camera'); // still off: even Mom is told so
  await expect(says).toHaveText('The camera is off.');
  await page.getByTestId('suggest-yes-mom').click();
  await expect(says).toHaveText('The hallway camera is on.');
  await expect(card).toHaveCount(0); // asked once
  await say(page, 'show the hallway camera'); // on now: Mom needs her own tap
  await expect(says).toContainText('Confirm on your phone:');
  await confirmOnPhone(page, 'mom');
  await expect(says).toHaveText('Done. The hallway looks quiet.');
  await page.getByTestId('who-guest').click();
  await say(page, 'show the hallway camera'); // a guest is refused it
  await expect(says).toHaveAttribute('data-outcome', 'denied');
  await page.screenshot({ path: SHOT('guest-refused-camera'), fullPage: true });
});

test('2 camera: saying No keeps it off', async ({ page }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');
  await addVacuum(page);
  await page.getByTestId('suggest-no-mom').click();
  await expect(says).toHaveText('Okay. The camera stays off.');
  await say(page, 'show the hallway camera');
  await expect(says).toHaveText('The camera is off.');
});

test('2 health: the vacuum says it is stuck and Mom is told in one sentence', async ({ page }) => {
  await page.goto(freshHouse());
  await addVacuum(page);
  await page.getByTestId('btn-vac-stuck').click();
  await page.getByTestId('btn-check-devices').click();
  await expect(page.getByTestId('phone-mom')).toContainText('The robot vacuum is stuck. Please check it.');
  await page.screenshot({ path: SHOT('vacuum-stuck-alert'), fullPage: true });
  await page.getByTestId('who-leo').click();
  await page.getByTestId('pin').fill('4821');
  await page.getByTestId('btn-pin').click();
  await say(page, 'start the vacuum');
  await expect(page.getByTestId('alexa-says')).toHaveText('The vacuum is stuck. An adult was told.');
});

test('1 kinds: a $12 bag order needs Mom\'s tap', async ({ page }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');
  await addVacuum(page);
  await say(page, 'order vacuum bags');
  await expect(says).toContainText('Confirm on your phone:'); // money = a tap on your own phone
  await page.screenshot({ path: SHOT('bag-needs-tap'), fullPage: true });
  await confirmOnPhone(page, 'mom');
  await expect(says).toHaveText('Done. You spent $12.');
});

test('3 scam guard: Grandma\'s $200 gift card is held with the warning', async ({ page }) => {
  await page.goto(`${freshHouse()}&grandma=1`);
  const says = page.getByTestId('alexa-says');
  await signIn(page, 'grandma');
  await say(page, 'buy a $200 gift card');
  await expect(says).toContainText('People pretending to be family often ask for this. Call them first.');
  await expect(says).toHaveAttribute('data-outcome', 'held');
  await expect(says).not.toContainText('Confirm on your phone'); // her own tap is not enough
  await expect(page.getByTestId('approval-mom')).toContainText('$200');
  await expect(page.getByTestId('approval-mom')).toContainText('People pretending to be family');
  await page.screenshot({ path: SHOT('grandma-gift-card'), fullPage: true });
  // Mom, another adult, can say yes by the number
  const n = (await says.textContent())!.match(/tap (\d\d) to say yes/)![1];
  await page.getByTestId(`approve-mom-num-${n}`).click();
  await expect(says).toHaveText('Done. You spent $200.');
});

// the next time that is `weekday` (1 = Monday) at hour:minute in New York
function at(weekday: number, hour: number, minute = 0): number {
  for (let t = Math.ceil(Date.now() / 60_000) * 60_000 + 86400_000; t < Date.now() + 10 * 86400_000; t += 60_000) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    if (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1 === weekday && Number(p.hour) === hour && Number(p.minute) === minute) return t;
  }
  throw new Error('no such time');
}
async function setClock(request: APIRequestContext, hh: string, at?: number) {
  const t = await (await request.get(`/demo-token?hh=${hh}`)).json();
  const r = await request.post('/demo/clock', { headers: { authorization: `Bearer ${t.token}` }, data: at === undefined ? {} : { at } });
  expect(r.ok()).toBe(true);
}

test('4 visitors: the dog walker is let in at 12:30 and refused at 3', async ({ page, request }) => {
  const url = freshHouse();
  const hh = houseOf(url);
  await page.goto(url);
  const says = page.getByTestId('alexa-says');
  try {
    await signIn(page, 'mom');
    await page.getByTestId('say').fill('let the dog walker in weekdays 12 to 1');
    await page.getByTestId('btn-say').click();
    await expect(page.getByTestId('rule-readback')).toContainText('Dog walker can come in on weekdays from 12 PM to 1 PM.');
    await confirmOnPhone(page, 'mom');
    const secret = page.getByTestId('phone-secret-mom');
    await expect(secret).toContainText('Their PIN is');
    const pin = (await secret.textContent())!.match(/PIN is (\d{4})/)![1];
    await page.getByTestId('who-guest').click();

    await setClock(request, hh, at(2, 12, 30)); // a Tuesday, 12:30 PM
    await say(page, `I'm Dog walker, my PIN is ${pin}`);
    await expect(says).toHaveText('Hi Dog walker.');
    await say(page, 'unlock the front door');
    await expect(says).toHaveText('Done. The front door is unlocked.');
    await page.screenshot({ path: SHOT('dog-walker-let-in'), fullPage: true });

    await setClock(request, hh, at(2, 15, 0)); // 3 PM
    await say(page, `I'm Dog walker, my PIN is ${pin}`);
    await expect(says).toHaveText('Hi Dog walker.');
    await say(page, 'unlock the front door');
    await expect(says).toHaveAttribute('data-outcome', 'denied');
    await expect(page.getByTestId('phone-mom')).toContainText('Dog walker tried the door at the wrong time. It stayed shut.');
    await page.screenshot({ path: SHOT('dog-walker-refused'), fullPage: true });
  } finally {
    await setClock(request, hh);
  }
});

test('5 project: "start a project: a website for my bakery" makes a plan; publishing asks for a tap', async ({ page, context }) => {
  await page.goto(freshHouse());
  const says = page.getByTestId('alexa-says');
  await signIn(page, 'maya');
  await say(page, 'start a project: a website for my bakery');
  await expect(says).toContainText('I am writing the plan.');
  await expect(says).toHaveText('Your plan is ready. It is on your phone.', { timeout: 15000 });
  const link = page.getByTestId('plan-link-maya');
  await expect(link).toHaveText('Your plan is ready. Tap to read it.');
  const planUrl = await link.getAttribute('href');
  const plan = await context.newPage();
  await plan.goto(planUrl!);
  await expect(plan.getByTestId('plan-text')).toContainText('bakery');
  await expect(plan.getByTestId('plan-state')).toHaveText('Not published. An adult must say yes first.');
  await plan.screenshot({ path: SHOT('project-plan'), fullPage: true });
  await page.screenshot({ path: SHOT('project-plan-on-phone'), fullPage: true });
  // publishing is acting in the family's name: Mom taps on her own phone
  await signIn(page, 'mom');
  await say(page, 'publish the bakery project');
  await expect(says).toContainText('Confirm on your phone:');
  await plan.reload();
  await expect(plan.getByTestId('plan-state')).toHaveText('Not published. An adult must say yes first.'); // nothing went out before the tap
  await page.screenshot({ path: SHOT('publish-asks-for-tap'), fullPage: true });
  await confirmOnPhone(page, 'mom');
  await expect(says).toHaveText('Done. It is published.');
  await plan.reload();
  await expect(plan.getByTestId('plan-state')).toHaveText('Published.');
});
