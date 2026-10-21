import { test, expect } from '@playwright/test';

const hh = () => `a0${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const init = (v: string) => ({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: v, capabilities: {}, clientInfo: { name: 'audit', version: '1' } } });
const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

test('S0 browser: connect, list tools, ask status; log shows raw answers', async ({ page }) => {
  await page.goto(`/?hh=${hh()}`);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByRole('button', { name: 'List tools' }).click();
  const log = page.getByTestId('log');
  await expect(log).toContainText('request_action', { timeout: 15000 });
  await expect(log).toContainText('household_status');
  await page.getByRole('button', { name: 'Ask: house status' }).click();
  await expect(log).toContainText('"result"');
  const txt = (await log.textContent())!;
  expect(txt).toContain('2025-11-25');
  await page.screenshot({ path: `audit/2026-10-21/s0-tools-${test.info().project.name}-${process.env.AUDIT_TARGET ?? 'local'}.png` });
});

test('S0 browser: no console errors on first load and tool list', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`/?hh=${hh()}`);
  await page.getByRole('button', { name: 'List tools' }).click();
  await expect(page.getByTestId('log')).toContainText('request_action', { timeout: 15000 });
  await page.waitForTimeout(2500);
  expect(errors, 'console errors').toEqual([]);
});

test('S0 http: both protocol versions initialize; bad Origin 403; no token 401; bad token 401', async ({ request, baseURL }) => {
  const tok = (await (await request.get(`/demo-token?hh=${hh()}`)).json()).token as string;
  expect(tok).toBeTruthy();
  const auth = { ...H, authorization: `Bearer ${tok}` };
  for (const v of ['2025-11-25', '2025-03-26']) {
    const r = await request.post('/mcp', { headers: auth, data: init(v) });
    expect(r.status(), v).toBe(200);
    const body = JSON.parse(await r.text().then((t) => t.replace(/^[\s\S]*?data: /, '').trim() || t));
    expect(body.result.protocolVersion, `negotiated for ${v}`).toBe(v);
  }
  const bad = await request.post('/mcp', { headers: { ...auth, origin: 'https://evil.example' }, data: init('2025-11-25') });
  expect(bad.status(), 'bad Origin').toBe(403);
  const none = await request.post('/mcp', { headers: H, data: init('2025-11-25') });
  expect(none.status(), 'no token').toBe(401);
  const junk = await request.post('/mcp', { headers: { ...H, authorization: 'Bearer not.a.token' }, data: init('2025-11-25') });
  expect(junk.status(), 'junk token').toBe(401);
  // bad origin must be refused even with NO token (never reaches the tools)
  const badNoTok = await request.post('/mcp', { headers: { ...H, origin: 'https://evil.example' }, data: init('2025-11-25') });
  expect([401, 403]).toContain(badNoTok.status());
  // same-origin Origin header is allowed
  const same = await request.post('/mcp', { headers: { ...auth, origin: new URL(baseURL!).origin }, data: init('2025-11-25') });
  expect(same.status(), 'same-origin ok').toBe(200);
});

test('S0 http: tools/list over raw HTTP has exactly the fixed ten tools and no person field on request_action', async ({ request }) => {
  const tok = (await (await request.get(`/demo-token?hh=${hh()}`)).json()).token as string;
  const r = await request.post('/mcp', { headers: { ...H, authorization: `Bearer ${tok}` }, data: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
  expect(r.status()).toBe(200);
  const t = await r.text();
  const body = JSON.parse(t.includes('data: ') ? t.replace(/^[\s\S]*?data: /, '').trim() : t);
  const names = body.result.tools.map((x: any) => x.name).sort();
  expect(names).toEqual(['approve_request','audit_log','confirm_identity','connect_service','find_capability','household_status','job_status','request_action','set_rule','show_on_screen']);
  const ra = body.result.tools.find((x: any) => x.name === 'request_action');
  const props = Object.keys(ra.inputSchema.properties);
  for (const p of props) expect(p).not.toMatch(/person|speaker|who|user|name/i);
});
