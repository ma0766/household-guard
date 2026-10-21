import { test, expect } from '@playwright/test';

test('S8: public notes are reachable without signing in; the app itself refuses a missing sign-in', async ({ page, request }) => {
  const privacy = await request.get('/privacy');
  expect(await privacy.text()).toContain('We do not store audio');
  const meta = await request.get('/.well-known/oauth-protected-resource');
  expect((await meta.json()).bearer_methods_supported).toEqual(['header']);
  const nope = await request.post('/mcp', { data: {}, headers: { accept: 'application/json, text/event-stream' } });
  expect(nope.status()).toBe(401);
  const evil = await request.post('/mcp', { data: {}, headers: { origin: 'https://evil.example' } });
  expect(evil.status()).toBe(403);
  await page.goto('/privacy');
  await page.screenshot({ path: 'test-results/s8-privacy.png' });
});
