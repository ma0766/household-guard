import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/server.js';
import { mintToken } from '../../src/auth.js';
import { newHousehold } from '../helpers.js';
import { confirmIdentity } from '../../src/identity/confirm.js';
import { getChallenge } from '../../src/approvals/challenge.js';
import { requestAction } from '../../src/core/request-action.js';

let server: Server;
let base: string;
beforeAll(async () => {
  server = createApp();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

const hh = 'sec' + Math.floor(Math.random() * 1e9);
const get = (path: string, token: string) => fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });

describe('S2 phones are personal', () => {
  it("the voice-side key cannot read or tap anyone's phone", async () => {
    expect((await get('/phone/mom/inbox', mintToken('demo', 300, hh))).status).toBe(403);
  });
  it("Maya's phone key cannot act as Mom's phone", async () => {
    expect((await get('/phone/mom/inbox', mintToken('maya', 300, hh, 'phone'))).status).toBe(403);
    const r = await fetch(`${base}/phone/mom/confirm`, { method: 'POST', headers: { authorization: `Bearer ${mintToken('maya', 300, hh, 'phone')}`, 'content-type': 'application/json' }, body: JSON.stringify({ challenge_id: 'x', number: 11 }) });
    expect(r.status).toBe(403);
  });
  it("Mom's own phone key works", async () => {
    expect((await get('/phone/mom/inbox', mintToken('mom', 300, hh, 'phone'))).status).toBe(200);
  });
  it('a phone key does not work as a voice key', async () => {
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${mintToken('mom', 300, hh, 'phone')}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
    expect(r.status).toBe(401);
  });
});

describe('S2 guessing guard holds under parallel guesses', () => {
  it('30 parallel wrong PINs: at most 3 are ever checked, the rest are locked', async () => {
    const { hh: h, deps } = await newHousehold();
    const out = await Promise.all(Array.from({ length: 30 }, () => confirmIdentity(deps, h, { name: 'Leo', pin: '0000' })));
    // "That PIN is not right." = the PIN was actually checked. Everything else was locked out or failed closed.
    expect(out.filter((o) => o.say === 'That PIN is not right.').length).toBeLessThanOrEqual(3);
    expect(out.every((o) => o.status !== 'confirmed')).toBe(true);
    expect((await confirmIdentity(deps, h, { name: 'Leo', pin: '4821' })).status).toBe('locked'); // even the right PIN
  });
  it('parallel confirmation requests: at most 3 numbers are ever issued', async () => {
    const { hh: h, deps } = await newHousehold();
    const out = await Promise.all(Array.from({ length: 12 }, () => confirmIdentity(deps, h, { name: 'Maya' })));
    expect(out.filter((o) => o.status === 'waiting').length).toBe(3);
  });
  it('tapping the wrong number is counted before it is checked too', async () => {
    const { hh: h, deps } = await newHousehold();
    const r = await confirmIdentity(deps, h, { name: 'Maya' });
    const c = (await getChallenge(deps, h, r.challenge_id!))!;
    const { phoneConfirm } = await import('../../src/identity/confirm.js');
    const wrong = c.options.find((n) => n !== c.number)!;
    const taps = await Promise.all(Array.from({ length: 10 }, () => phoneConfirm(deps, h, 'maya', { challenge_id: c.id, number: wrong })));
    expect(taps.filter((t) => t.status === 'wrong').length).toBeLessThanOrEqual(3);
    // after the lock, the RIGHT number is refused
    expect((await phoneConfirm(deps, h, 'maya', { challenge_id: c.id, number: c.number })).status).toBe('locked');
    expect((await requestAction(deps, h, { service: 'sim-home', action: 'light', value: 'on' })).person).toBe('guest');
  });
});
