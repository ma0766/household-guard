import { test, expect } from '@playwright/test';
import { freshHouse, signIn } from './helpers.js';

test('S12: the page signs in with a family account (code + PKCE) and the house answers it', async ({ page }) => {
  await page.goto(freshHouse());
  await expect(page.getByTestId('btn-signin')).toBeVisible();
  await page.getByTestId('btn-signin').click();
  await expect(page.getByTestId('account-status')).toHaveText('Signed in with your family account.');
  await page.getByRole('button', { name: 'Ask: house status' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-token-kind', 'family-account');
  await expect(page.getByTestId('log')).toContainText('Your house is quiet');
  await page.screenshot({ path: 'test-results/s12-family-account.png' });
});

test('S12: a held ride sends Mom an email; its link opens a page; Mom says yes there and the ride is booked', async ({ page, browser, request }) => {
  await page.goto(freshHouse());
  await signIn(page, 'maya');
  await page.getByRole('button', { name: 'Book a ride to the airport' }).click();
  const says = page.getByTestId('alexa-says');
  await expect(says).toContainText("Held: over Maya's $20 a week.");
  const number = (await says.textContent())!.match(/tap (\d\d) to say yes/)![1];

  // the email "sent" to Mom (the local demo keeps it in an outbox)
  const sent = ((await (await request.get('/demo/outbox')).json()) as { sent: { to: string; subject: string; text: string }[] }).sent;
  const mail = sent.filter((m) => m.to === 'mom@example.test').pop()!;
  expect(mail.subject).toBe('Maya wants a ride to the airport: $38');
  const link = mail.text.match(/https?:\/\/\S+\/approve\?t=\S+/)![0];

  // Mom's own phone: a page with no other sign-in
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 700 } })).newPage();
  await phone.goto(link);
  await expect(phone.getByText('Maya wants: ride to the airport')).toBeVisible();
  await expect(phone.getByText('$38')).toBeVisible();
  await expect(phone.getByText("Held: over Maya's $20 a week.")).toBeVisible();
  await phone.screenshot({ path: 'test-results/s12-email-link-page.png' });
  await phone.getByTestId(`link-num-${number}`).click();
  await expect(phone.getByText('Okay. Booking it now.')).toBeVisible();
  await phone.screenshot({ path: 'test-results/s12-email-link-approved.png' });

  // the house booked it
  await expect(page.frameLocator('[data-testid=timeline]').getByText(/Ride booked for Maya/)).toBeVisible({ timeout: 15000 });
});
