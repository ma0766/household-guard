import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/server.js';
import { mintToken } from '../../src/auth.js';
import { allow } from '../../src/ratelimit.js';
import { newHousehold, speakAs } from '../helpers.js';

// Phase 4: every route says who may use it; no signed-in key means nothing private; busy callers are slowed; huge input is refused.
let server: Server;
let base: string;
let ctx: Awaited<ReturnType<typeof newHousehold>>;
const saved = { ...process.env };
beforeAll(async () => {
  process.env.HG_LOCAL = '1';
  ctx = await newHousehold();
  server = createApp(ctx.deps);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { process.env = saved; await new Promise((r) => server.close(r)); });
const hdr = (extra: Record<string, string> = {}) => ({ 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...extra });

describe('every route and who may use it (no key)', () => {
  const PRIVATE: [string, string][] = [['POST', '/mcp'], ['GET', '/mcp'], ['GET', '/phone/mom/inbox'], ['POST', '/phone/mom/confirm'], ['POST', '/phone/mom/approve'], ['POST', '/phone/mom/reject'], ['POST', '/demo/guest'], ['POST', '/demo/break-ride'], ['POST', '/demo/check-rides']];
  for (const [method, path] of PRIVATE) {
    it(`${method} ${path} needs a key`, async () => {
      const r = await fetch(`${base}${path}`, { method, headers: hdr(), body: method === 'POST' ? '{}' : undefined });
      expect(r.status).toBe(401);
    });
  }
  const PUBLIC: [string, string, number[]][] = [['GET', '/healthz', [200]], ['GET', '/privacy', [200]], ['GET', '/config.json', [200]], ['GET', '/.well-known/oauth-protected-resource', [200]], ['GET', '/.well-known/household-guard.json', [200]], ['GET', '/approve', [200]], ['GET', '/preview/does-not-exist-123456', [404]], ['GET', '/standin/connect/aaaaaaaaaaaa', [200, 404]], ['POST', '/webhooks/composio', [401]]];
  for (const [method, path, ok] of PUBLIC) {
    it(`${method} ${path} is public and shows nothing private`, async () => {
      const r = await fetch(`${base}${path}`, { method, headers: hdr(), body: method === 'POST' ? '{}' : undefined });
      expect(ok).toContain(r.status);
      expect(await r.text()).not.toMatch(/HG_TOKEN_SECRET|AKIA|BEGIN PRIVATE KEY/);
    });
  }
  it('an unknown route is a plain 404, not an error page with details', async () => {
    const r = await fetch(`${base}/nothing/here`);
    expect(r.status).toBe(404);
    expect((await r.text()).length).toBeLessThan(200);
  });
});

describe('a key for one thing is not a key for another', () => {
  it('a phone key does not open /mcp; a voice key does not open a phone; a bad key opens nothing', async () => {
    const hh = `t${randomUUID().slice(0, 8)}`;
    expect((await fetch(`${base}/mcp`, { method: 'POST', headers: hdr({ authorization: `Bearer ${mintToken('mom', 60, hh, 'phone')}` }), body: '{}' })).status).toBe(401);
    expect((await fetch(`${base}/phone/mom/inbox`, { headers: { authorization: `Bearer ${mintToken('demo', 60, hh)}` } })).status).toBe(403);
    expect((await fetch(`${base}/mcp`, { method: 'POST', headers: hdr({ authorization: 'Bearer not-a-key' }), body: '{}' })).status).toBe(401);
  });
});

describe('busy callers are slowed (and a broken limiter refuses)', () => {
  it('the counter lets exactly the limit through, even in parallel', async () => {
    const key = `test#${randomUUID()}`;
    const oks = await Promise.all(Array.from({ length: 25 }, () => allow(ctx.store, key, 10)));
    expect(oks.filter(Boolean)).toHaveLength(10);
  });
  it('a limiter that cannot reach its table refuses', async () => {
    const broken = new Proxy(ctx.store, { get: (t, k) => (k === 'update' ? async () => { throw new Error('down'); } : (t as any)[k]) });
    expect(await allow(broken as typeof ctx.store, 'x', 10)).toBe(false);
  });
  it('/mcp answers 429 with a wait time after too many calls from one house', async () => {
    const hh = `t${randomUUID().slice(0, 8)}`;
    const token = mintToken('demo', 60, hh);
    const { LIMITS } = await import('../../src/ratelimit.js');
    const { Store } = await import('../../src/core/store.js');
    // fill this minute's counter to the limit, then one more call is refused
    await ctx.store.put({ pk: 'RATE', sk: `mcp#${hh}#${Math.floor(Date.now() / 60_000)}`, n: LIMITS.mcpPerHouse, ttl: Math.floor(Date.now() / 1000) + 300 });
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: hdr({ authorization: `Bearer ${token}` }), body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBeTruthy();
    expect(Store).toBeTruthy();
  });
});

describe('input bounds on every tool', () => {
  it('huge or odd arguments are refused by the tool, not run', async () => {
    const hh = `t${randomUUID().slice(0, 8)}`;
    const token = mintToken('demo', 60, hh);
    await speakAs(ctx.store, hh, 'mom');
    const call = async (name: string, args: unknown) => ((await (await fetch(`${base}/mcp`, { method: 'POST', headers: hdr({ authorization: `Bearer ${token}` }), body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json()) as any).result;
    const big = 'x'.repeat(5000);
    for (const [name, args] of [['request_action', { service: big, action: 'light' }], ['request_action', { service: 'sim-home', action: 'light', item: big }], ['confirm_identity', { name: big }], ['approve_request', { approval_id: big }], ['job_status', { job_id: big }], ['find_capability', { query: big }], ['connect_service', { toolkit: big }], ['set_rule', { template: 'allowed_apps', services: Array(500).fill('a') }], ['approve_request', { approval_id: 'x', number: 1e12 }]] as const) {
      const r = await call(name, args);
      expect(r?.isError, `${name} ${JSON.stringify(args).slice(0, 40)}`).toBe(true);
    }
    expect((await call('request_action', { service: 'sim-home', action: 'light', item: 'lights', value: 'off' }))?.isError).toBeFalsy(); // a normal call still works
  });
});
