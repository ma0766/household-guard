import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { createApp } from '../../src/server.js';
import { mintToken } from '../../src/auth.js';
import { newHousehold } from '../helpers.js';
import { startFakeOidc, type FakeOidc } from '../fake-oidc.js';
import { Store } from '../../src/core/store.js';

// S12: sign in through an OAuth 2.1 server (Amazon Cognito in AWS; a stand-in with the same token shape here).
let oidc: FakeOidc;
let server: Server;
let base: string;
let store: Store;
const saved = { ...process.env };
beforeAll(async () => {
  oidc = await startFakeOidc();
  Object.assign(process.env, { HG_OIDC_ISSUER: oidc.issuer, HG_OIDC_JWKS_URI: oidc.jwksUri, HG_OIDC_CLIENT_IDS: 'web-client', HG_OIDC_SERVICE_CLIENT_ID: 'svc-client', HG_SERVICE_HOUSEHOLD: 'svc-house' });
  const ctx = await newHousehold();
  store = ctx.store;
  server = createApp(ctx.deps);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  process.env = saved;
  await new Promise((r) => server.close(r));
  await oidc.close();
});

const hh = () => `t${randomUUID().slice(0, 8)}`;
const mcp = (token: string | undefined, method = 'tools/list') =>
  fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: method === 'tools/call' ? { name: 'household_status', arguments: {} } : {} }) });

describe('S12 sign-in with a family account', () => {
  it('a valid access token for a household group opens that household, and only that one', async () => {
    const h = hh();
    const token = await oidc.sign({ 'cognito:groups': [`hh-${h}`] });
    const r = await mcp(token, 'tools/call');
    expect(r.status).toBe(200);
    expect(JSON.stringify(await r.json())).toContain('Your house is quiet');
    expect(await store.get(Store.hk(h), 'META')).toBeTruthy(); // the house was set up under THAT group's id
  });

  const refused: [string, () => Promise<string | undefined>][] = [
    ['no token', async () => undefined],
    ['signed by another key', async () => oidc.sign({ 'cognito:groups': ['hh-a'] }, { key: await oidc.otherKey() })],
    ['wrong issuer', async () => oidc.sign({ 'cognito:groups': ['hh-a'] }, { issuer: 'https://evil.example' })],
    ['expired', async () => oidc.sign({ 'cognito:groups': ['hh-a'] }, { expiresIn: '-1h' })],
    ['an ID token, not an access token', async () => oidc.sign({ 'cognito:groups': ['hh-a'], token_use: 'id' })],
    ['a client we do not know', async () => oidc.sign({ 'cognito:groups': ['hh-a'], client_id: 'someone-elses-app' })],
    ['a user in no household', async () => oidc.sign({ 'cognito:groups': [] })],
    ['a user in two households (no guessing)', async () => oidc.sign({ 'cognito:groups': ['hh-a', 'hh-b'] })],
    ['a group that is not a household name', async () => oidc.sign({ 'cognito:groups': ['admin'] })],
    ['a household name with odd characters', async () => oidc.sign({ 'cognito:groups': ['hh-../etc'] })],
    ['alg none', async () => `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ iss: oidc.issuer, token_use: 'access', client_id: 'web-client', 'cognito:groups': ['hh-a'], exp: 9999999999 })).toString('base64url')}.`],
    ['an HS256 token signed with the public key text', async () => new SignJWT({ token_use: 'access', client_id: 'web-client', 'cognito:groups': ['hh-a'] }).setProtectedHeader({ alg: 'HS256', kid: 'k1' }).setIssuer(oidc.issuer).setExpirationTime('1h').sign(new TextEncoder().encode('anything'))],
    ['an access token without the house scope (only openid)', async () => oidc.sign({ 'cognito:groups': ['hh-a'], scope: 'openid' })],
    ['a tampered token', async () => { const t = await oidc.sign({ 'cognito:groups': ['hh-a'] }); const p = t.split('.'); p[1] = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p[1], 'base64url').toString()), 'cognito:groups': ['hh-other'] })).toString('base64url'); return p.join('.'); }],
  ];
  for (const [name, make] of refused) {
    it(`refuses ${name}`, async () => {
      expect((await mcp(await make())).status).toBe(401);
    });
  }

  it('a service client (client_credentials: no user, no groups) speaks for the service household only', async () => {
    const token = await oidc.sign({ client_id: 'svc-client', sub: 'svc-client' });
    expect((await mcp(token, 'tools/call')).status).toBe(200);
    expect(await store.get(Store.hk('svc-house'), 'META')).toBeTruthy();
    // the same kind of token from the WEB client (a user client with no groups) is refused
    expect((await mcp(await oidc.sign({ client_id: 'web-client', 'cognito:groups': [] }))).status).toBe(401);
  });

  it('a signed-in token is the voice side only: it can never act as a phone', async () => {
    const token = await oidc.sign({ 'cognito:groups': ['hh-a'] });
    for (const path of ['inbox', 'confirm', 'approve']) {
      const r = await fetch(`${base}/phone/mom/${path}`, { method: path === 'inbox' ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: path === 'inbox' ? undefined : '{}' });
      expect(r.status, path).toBe(403);
    }
  });

  it('a direct-login token (no house scope) is refused unless that is switched on for this stage', async () => {
    const direct = await oidc.sign({ 'cognito:groups': [`hh-${hh()}`], scope: 'aws.cognito.signin.user.admin' });
    expect((await mcp(direct)).status).toBe(401);
    process.env.HG_OIDC_ALLOW_DIRECT = '1';
    expect((await mcp(direct)).status).toBe(200);
    delete process.env.HG_OIDC_ALLOW_DIRECT;
  });

  it('the demo buttons are for the voice side only: a phone key, an email link or a service key cannot use them', async () => {
    process.env.HG_DEMO = '1';
    const { mintLinkToken } = await import('../../src/auth.js');
    const h = hh();
    const bad = [mintToken('mom', 60, h, 'phone'), mintLinkToken('mom', h, 'abc', 60), await oidc.sign({ client_id: 'svc-client', sub: 'svc-client' })];
    for (const t of bad) for (const path of ['/demo/guest', '/demo/break-ride', '/demo/check-rides']) expect((await fetch(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${t}` } })).status, path).toBe(403);
    expect((await fetch(`${base}/demo/guest`, { method: 'POST', headers: { authorization: `Bearer ${mintToken('demo', 60, h)}` } })).status).toBe(200);
  });

  it('the older demo sign-in keeps working next to it, behind its own flag', async () => {
    expect((await mcp(mintToken('demo', 60, hh()))).status).toBe(200);
    process.env.HG_DEMO = '0';
    delete process.env.HG_LOCAL;
    expect((await fetch(`${base}/demo-token`)).status).not.toBe(200); // the open sign-in is switched off...
    expect((await mcp(await oidc.sign({ 'cognito:groups': [`hh-${hh()}`] }))).status).toBe(200); // ...the real one is not
    process.env.HG_DEMO = '1';
    expect((await fetch(`${base}/demo-token`)).status).toBe(200);
  });
});

describe('S12 what the app tells a client about sign-in', () => {
  it('the protected-resource note names the sign-in server', async () => {
    const j = (await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json()) as any;
    expect(j.authorization_servers).toEqual([oidc.issuer]);
  });
  it('/config.json says how to sign in, with no secrets, and nothing when it is not set up', async () => {
    Object.assign(process.env, { HG_OIDC_AUTHORIZE_URL: `${oidc.issuer}/oauth2/authorize`, HG_OIDC_TOKEN_URL: `${oidc.issuer}/oauth2/token`, HG_OIDC_WEB_CLIENT_ID: 'web-client' });
    const j = (await (await fetch(`${base}/config.json`)).json()) as any;
    expect(j.sign_in).toEqual({ authorize_url: `${oidc.issuer}/oauth2/authorize`, token_url: `${oidc.issuer}/oauth2/token`, client_id: 'web-client', scope: 'openid hg/mcp' });
    expect(JSON.stringify(j)).not.toMatch(/secret|password/i);
    delete process.env.HG_OIDC_AUTHORIZE_URL;
    expect(((await (await fetch(`${base}/config.json`)).json()) as any).sign_in).toBeNull();
  });
});
