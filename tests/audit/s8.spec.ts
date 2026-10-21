import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { freshHouse, watchConsole } from './common.js';

// S8 "Done when": token checked on every call; /privacy + /.well-known load; README, FEEDBACK, FRICTION_LOG, LICENSE exist.
const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

test('S8 token is checked on every call (401) and the signed-in page still works', async ({ page, request }) => {
  await page.goto(freshHouse('s8'));
  await page.getByRole('button', { name: 'List tools' }).click();
  await expect(page.getByTestId('log')).toContainText('household_status', { timeout: 15000 });
  await page.screenshot({ path: 'audit/2026-10-21/s8-tools-listed.png' });
  // grab a real key the way the page does, then break it in several ways
  const hh = new URL(page.url()).searchParams.get('hh')!;
  const t = await (await request.get(`/demo-token?hh=${hh}`)).json();
  const good = t.token as string;
  const bad: Record<string, string | undefined> = {
    'no token': undefined, 'empty bearer': '', 'garbage': 'abc', 'tampered last char': good.slice(0, -1) + (good.endsWith('A') ? 'B' : 'A'),
    'tampered middle': good.slice(0, 10) + (good[10] === 'x' ? 'y' : 'x') + good.slice(11),
  };
  for (const [name, tok] of Object.entries(bad)) {
    const r = await request.post('/mcp', { headers: { ...H, ...(tok === undefined ? {} : { authorization: `Bearer ${tok}` }) }, data: rpc });
    expect(r.status(), `/mcp with ${name}`).toBe(401);
  }
  for (const m of ['tools/call']) {
    const r = await request.post('/mcp', { headers: H, data: { jsonrpc: '2.0', id: 2, method: m, params: { name: 'household_status', arguments: {} } } });
    expect(r.status(), 'tools/call without a token').toBe(401);
  }
  // valid token works
  const ok = await request.post('/mcp', { headers: { ...H, authorization: `Bearer ${good}` }, data: rpc });
  expect(ok.status()).toBe(200);
  // every phone route refuses no token / the voice-side token
  for (const [method, p] of [['get', '/phone/mom/inbox'], ['post', '/phone/mom/confirm'], ['post', '/phone/mom/approve'], ['post', '/phone/mom/reject']] as const) {
    for (const auth of [undefined, `Bearer ${good}`, 'Bearer nope']) {
      const r = await request.fetch(p, { method, headers: { ...H, ...(auth ? { authorization: auth } : {}) }, data: method === 'post' ? {} : undefined });
      // a valid voice-side key on a phone route is refused as the wrong kind of key (403 observed); no key / junk = 401
      const okCodes = auth === `Bearer ${good}` ? [401, 403] : [401];
      expect(okCodes, `${method} ${p} with ${auth ? auth.slice(0, 12) : 'no token'} got ${r.status()}`).toContain(r.status());
    }
  }
  // demo buttons without a key
  for (const p of ['/demo/break-ride', '/demo/check-rides', '/demo/guest']) {
    const r = await request.post(p, { headers: H });
    expect([401, 404], `${p} without key`).toContain(r.status());
    expect(r.status(), `${p} without key must not succeed`).not.toBe(200);
  }
  // bad Origin
  const o = await request.post('/mcp', { headers: { ...H, authorization: `Bearer ${good}`, origin: 'https://evil.example' }, data: rpc });
  expect(o.status()).toBe(403);
});

test('S8 UX: the page opens and lists tools with zero console errors', async ({ page }) => {
  const errs = watchConsole(page);
  await page.goto(freshHouse('s8c'));
  await page.getByRole('button', { name: 'List tools' }).click();
  await expect(page.getByTestId('log')).toContainText('household_status', { timeout: 15000 });
  await page.waitForTimeout(2500); // let the timeline and rules frames draw
  expect(errs, 'console errors on a plain page load').toEqual([]);
});

test('S8 privacy page and well-known pages load', async ({ page, request }) => {
  const errs = watchConsole(page);
  const r = await page.goto('/privacy');
  expect(r!.status()).toBe(200);
  const body = await page.locator('body').innerText();
  console.log('PRIVACY TEXT:\n' + body);
  expect(body.length).toBeGreaterThan(100);
  expect(body.toLowerCase()).toMatch(/audio/);
  expect(body.toLowerCase()).toMatch(/90 days|ninety/);
  await page.screenshot({ path: 'audit/2026-10-21/s8-privacy.png' });
  for (const p of ['/.well-known/household-guard.json', '/.well-known/oauth-protected-resource']) {
    const w = await request.get(p);
    expect(w.status(), p).toBe(200);
    const j = await w.json();
    console.log(p, JSON.stringify(j));
    expect(JSON.stringify(j)).toMatch(/mcp/);
  }
  expect(errs).toEqual([]);
});

test('S8 submission files exist (CLI evidence)', () => {
  for (const f of ['README.md', 'FEEDBACK.md', 'FRICTION_LOG.md', 'LICENSE']) {
    expect(existsSync(f), f).toBe(true);
    expect(readFileSync(f, 'utf8').length, `${f} not empty`).toBeGreaterThan(200);
  }
  expect(readFileSync('LICENSE', 'utf8')).toMatch(/MIT License/i);
  expect(readFileSync('FRICTION_LOG.md', 'utf8')).toMatch(/severity/i);
});
