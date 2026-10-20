import { describe, expect, it } from 'vitest';
import { newHousehold } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';
import { confirmIdentity, phoneConfirm, phoneInbox } from '../../src/identity/confirm.js';
import { getChallenge } from '../../src/approvals/challenge.js';
import { getSession } from '../../src/core/household.js';
import { Store } from '../../src/core/store.js';
import { readHome } from '../../src/connectors/sim-home.js';
import { jobStatus } from '../../src/core/jobs.js';

const unlock = { service: 'sim-home', action: 'unlock', item: 'front door' };
const MIN = 60_000;

async function loginByPhone(deps: any, hh: string, name: string) {
  const r = await confirmIdentity(deps, hh, { name });
  expect(r.status).toBe('waiting');
  const c = (await getChallenge(deps, hh, r.challenge_id!))!;
  return phoneConfirm(deps, hh, name.toLowerCase(), { challenge_id: c.id, number: c.number });
}

describe('S2 who is speaking', () => {
  it('"I\'m Mom, unlock the door" with no Mom confirmation → denied', async () => {
    const { hh, deps, store } = await newHousehold();
    const r = await confirmIdentity(deps, hh, { name: 'Mom' }); // a name alone proves nothing
    expect(r.status).toBe('waiting');
    expect(await getSession(store, hh)).toBeUndefined();
    const a = await requestAction(deps, hh, { ...unlock, person: 'mom' } as any);
    expect(a).toMatchObject({ outcome: 'denied', person: 'guest' });
    expect(await readHome(store, hh)).toEqual([]);
  });

  it('a wrong number on the phone does not sign anyone in', async () => {
    const { hh, deps, store } = await newHousehold();
    const r = await confirmIdentity(deps, hh, { name: 'Mom' });
    const c = (await getChallenge(deps, hh, r.challenge_id!))!;
    const wrong = c.options.find((n) => n !== c.number)!;
    expect((await phoneConfirm(deps, hh, 'mom', { challenge_id: c.id, number: wrong })).status).toBe('wrong');
    expect(await getSession(store, hh)).toBeUndefined();
  });

  it('Mom confirms on her phone, then unlock needs one more tap on HER phone, then runs', async () => {
    const { hh, deps, store } = await newHousehold();
    expect((await loginByPhone(deps, hh, 'Mom')).status).toBe('confirmed');
    expect((await getSession(store, hh))?.personId).toBe('mom');
    const a = await requestAction(deps, hh, unlock);
    expect(a).toMatchObject({ outcome: 'allowed', done: false, next: 'confirm_on_phone' });
    expect(await readHome(store, hh)).toEqual([]); // nothing happened yet
    expect((await jobStatus(deps, hh, a.job_id as string)).status).toBe('waiting');
    const c = (await getChallenge(deps, hh, a.job_id as string))!;
    expect(a.say).toBe(`Confirm on your phone: ${c.number}`);
    const done = await phoneConfirm(deps, hh, 'mom', { challenge_id: c.id, number: c.number });
    expect(done).toMatchObject({ status: 'confirmed' });
    expect(await readHome(store, hh)).toContainEqual({ device: 'front door', state: 'unlocked' });
    expect((await jobStatus(deps, hh, c.id)).status).toBe('done');
    // a second tap on the same challenge cannot run it again
    expect((await phoneConfirm(deps, hh, 'mom', { challenge_id: c.id, number: c.number })).status).toBe('expired');
  });

  it('the number lands on the right phone, and nobody else can tap it', async () => {
    const { hh, deps } = await newHousehold();
    await loginByPhone(deps, hh, 'Mom');
    const a = await requestAction(deps, hh, unlock);
    expect((await phoneInbox(deps, hh, 'mom')).challenges.map((c) => c.id)).toContain(a.job_id);
    expect((await phoneInbox(deps, hh, 'maya')).challenges).toEqual([]);
    const c = (await getChallenge(deps, hh, a.job_id as string))!;
    // Maya taps the right number on Mom's challenge → refused
    expect((await phoneConfirm(deps, hh, 'maya', { challenge_id: c.id, number: c.number })).status).toBe('not_yours');
    // the inbox never reveals which of the three numbers is right
    const shown = (await phoneInbox(deps, hh, 'mom')).challenges[0] as any;
    expect(shown.options).toHaveLength(3);
    expect(JSON.stringify(shown)).not.toMatch(/"number"/);
  });

  it('a 4th confirmation request in 10 minutes → locked, and an adult is told', async () => {
    let t = 1_800_000_000_000;
    const { hh, deps } = await newHousehold({ now: () => t });
    for (let i = 0; i < 3; i++) expect((await confirmIdentity(deps, hh, { name: 'Maya' })).status).toBe('waiting');
    const fourth = await confirmIdentity(deps, hh, { name: 'Maya' });
    expect(fourth.status).toBe('locked');
    expect((await phoneInbox(deps, hh, 'mom')).notices.map((n) => n.text).join(' ')).toMatch(/Maya/);
    t += 5 * MIN;
    expect((await confirmIdentity(deps, hh, { name: 'Maya' })).status).toBe('locked');
    t += 6 * MIN; // lock over
    expect((await confirmIdentity(deps, hh, { name: 'Maya' })).status).toBe('waiting');
  });

  it('three wrong numbers lock the person', async () => {
    const { hh, deps } = await newHousehold();
    const r = await confirmIdentity(deps, hh, { name: 'Maya' });
    const c = (await getChallenge(deps, hh, r.challenge_id!))!;
    const wrong = c.options.find((n) => n !== c.number)!;
    const out = [];
    for (let i = 0; i < 3; i++) out.push((await phoneConfirm(deps, hh, 'maya', { challenge_id: c.id, number: wrong })).status);
    expect(out).toEqual(['wrong', 'wrong', 'locked']);
    expect((await confirmIdentity(deps, hh, { name: 'Maya' })).status).toBe('locked');
  });

  it('people without a phone use a PIN, stored hashed', async () => {
    const { hh, deps, store } = await newHousehold();
    const row = await store.get(Store.hk(hh), 'PERSON#leo');
    expect(row?.pinHash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(row)).not.toContain('4821');
    expect((await confirmIdentity(deps, hh, { name: 'Leo', pin: '0000' })).status).toBe('failed');
    expect((await confirmIdentity(deps, hh, { name: 'Leo', pin: '4821' })).status).toBe('confirmed');
    expect(await getSession(store, hh)).toMatchObject({ personId: 'leo', method: 'pin' });
    // PIN users do low-risk things with no phone; they can still not unlock
    const lights = await requestAction(deps, hh, { service: 'sim-home', action: 'light', item: 'lights', value: 'on' });
    expect(lights).toMatchObject({ outcome: 'allowed', done: true });
    expect((await requestAction(deps, hh, unlock)).outcome).toBe('denied');
  });

  it('3 wrong PINs lock for 10 minutes', async () => {
    let t = 1_800_000_000_000;
    const { hh, deps } = await newHousehold({ now: () => t });
    const r = [];
    for (let i = 0; i < 3; i++) r.push((await confirmIdentity(deps, hh, { name: 'Leo', pin: '1111' })).status);
    expect(r).toEqual(['failed', 'failed', 'locked']);
    expect((await confirmIdentity(deps, hh, { name: 'Leo', pin: '4821' })).status).toBe('locked');
    t += 11 * MIN;
    expect((await confirmIdentity(deps, hh, { name: 'Leo', pin: '4821' })).status).toBe('confirmed');
  });

  it('an adult who only gave a PIN cannot unlock (held: confirm on the phone)', async () => {
    const { hh, deps, store } = await newHousehold();
    const { setSession } = await import('../../src/core/household.js');
    await setSession(store, hh, 'mom', 'pin');
    expect(await requestAction(deps, hh, unlock)).toMatchObject({ outcome: 'held', reason: 'Confirm on your phone first.' });
  });

  it('a confirmed session ends after 5 minutes → back to guest', async () => {
    let t = 1_800_000_000_000;
    const { hh, deps } = await newHousehold({ now: () => t });
    await loginByPhone(deps, hh, 'Mom');
    expect((await requestAction(deps, hh, { service: 'sim-home', action: 'light', value: 'on' })).person).toBe('mom');
    t += 6 * MIN;
    expect((await requestAction(deps, hh, { service: 'sim-home', action: 'light', value: 'on' })).person).toBe('guest');
  });
});
