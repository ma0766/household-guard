import { describe, expect, it } from 'vitest';
import { newHousehold, speakAs } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';
import { phoneConfirm, phoneInbox } from '../../src/identity/confirm.js';
import { getChallenge } from '../../src/approvals/challenge.js';
import { loadHousehold } from '../../src/core/household.js';
import { answerSuggestion } from '../../src/devices/suggest.js';
import { setVacuumStatus } from '../../src/devices/vacuum.js';
import { checkDevices } from '../../src/devices/health.js';
import { Store } from '../../src/core/store.js';
import { readAudit } from '../../src/audit/audit.js';
import { home, tap } from '../s20/helpers.js';
import type { Ctx } from '../s20/helpers.js';

const KEY = 'sk-demo-vacuum-9f3a77';
const connect = { service: 'devices', action: 'connect_device', item: 'robot vacuum' };
const vac = (value = 'start') => ({ service: 'robot-vacuum', action: 'vacuum', value });

async function connected(): Promise<Ctx> {
  const ctx = await newHousehold();
  await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
  const r = await requestAction(ctx.deps, ctx.hh, connect);
  const c = (await getChallenge(ctx.deps, ctx.hh, r.job_id as string))!;
  const out = await phoneConfirm(ctx.deps, ctx.hh, 'mom', { challenge_id: c.id, number: c.number, key: KEY });
  expect(out.result?.done, JSON.stringify(out)).toBe(true);
  return ctx;
}
const everything = async (ctx: Ctx) => JSON.stringify(await Promise.all(['AUDIT#', 'CHAL#', 'RULECHG#', 'RULES#', 'NOTICE#', 'PERSON#', 'JOB#', 'SUGGEST#'].map((p) => ctx.store.query(Store.hk(ctx.hh), p))));

describe('a new device, safe by default', () => {
  it('"connect my new robot vacuum" answers at once and starts a card on the adult\'s phone; nothing is added yet', async () => {
    // best of three fresh houses: the tests run in parallel with others, so one slow moment on a busy machine is not the answer time
    let best = Infinity;
    let ctx = await newHousehold();
    let r = await requestAction(ctx.deps, ctx.hh, connect);
    for (let i = 0; i < 3; i++) {
      ctx = await newHousehold();
      await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
      const t0 = Date.now();
      r = await requestAction(ctx.deps, ctx.hh, connect);
      best = Math.min(best, Date.now() - t0);
    }
    expect(best).toBeLessThan(500);
    expect(r).toMatchObject({ outcome: 'allowed', done: false, next: 'finish_on_phone', tier: 'high' });
    expect(r.say).toBe(`Finish on your phone. Type the key there. Confirm on your phone: ${r.number}`);
    const card = (await phoneInbox(ctx.deps, ctx.hh, 'mom')).challenges[0];
    expect(card).toMatchObject({ kind: 'rule', needs_key: true });
    expect(card.text).toContain('robot vacuum');
    expect((await loadHousehold(ctx.store, ctx.hh)).rules.serviceKinds).toBeUndefined();
  });
  it('kids, teens, guests (and an unconfirmed voice) cannot add a device, and get no card', async () => {
    for (const [who, method] of [['maya', 'phone'], ['leo', 'pin'], ['guest', 'phone']] as const) {
      const ctx = await newHousehold();
      await speakAs(ctx.store, ctx.hh, who, method);
      const r = await requestAction(ctx.deps, ctx.hh, connect);
      expect(r.outcome, who).toBe('denied');
      expect(r.next).toBeUndefined();
      expect((await phoneInbox(ctx.deps, ctx.hh, 'mom')).challenges, who).toHaveLength(0);
    }
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'pin'); // an adult who only said a PIN
    expect((await requestAction(ctx.deps, ctx.hh, connect)).outcome).not.toBe('allowed');
  });
  it('an unknown device is refused with a plain line', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const r = await requestAction(ctx.deps, ctx.hh, { ...connect, item: 'flying toaster' });
    expect(r).toMatchObject({ outcome: 'denied', reason: "I don't know that device." });
  });
  it('the key is typed only on the phone: no key, no connection; with the key it is added, kinds declared, key stored encrypted and nowhere else', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const r = await requestAction(ctx.deps, ctx.hh, connect);
    const c = (await getChallenge(ctx.deps, ctx.hh, r.job_id as string))!;
    const nokey = await phoneConfirm(ctx.deps, ctx.hh, 'mom', { challenge_id: c.id, number: c.number });
    expect(nokey).toMatchObject({ status: 'wrong', say: 'Type the key on your phone first.' });
    expect((await loadHousehold(ctx.store, ctx.hh)).rules.serviceKinds).toBeUndefined();
    const ok = await phoneConfirm(ctx.deps, ctx.hh, 'mom', { challenge_id: c.id, number: c.number, key: KEY });
    expect(ok.status).toBe('confirmed');
    const rules = (await loadHousehold(ctx.store, ctx.hh)).rules;
    expect(rules.serviceKinds?.['robot-vacuum']).toEqual(['control', 'money']);
    expect(rules.allowedServices).toContain('robot-vacuum');
    const stored = await ctx.store.get(Store.hk(ctx.hh), 'DEVKEY#robot-vacuum');
    expect(stored?.ct).toBeTruthy();
    expect(JSON.stringify(stored)).not.toContain(KEY);
    expect(await everything(ctx)).not.toContain(KEY); // not in the log, the rule record, the card, the job, the notices
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
  it('a teen cannot finish another adult\'s card, and a wrong number saves no key', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const r = await requestAction(ctx.deps, ctx.hh, connect);
    const c = (await getChallenge(ctx.deps, ctx.hh, r.job_id as string))!;
    expect((await phoneConfirm(ctx.deps, ctx.hh, 'maya', { challenge_id: c.id, number: c.number, key: KEY })).status).toBe('not_yours');
    expect((await phoneConfirm(ctx.deps, ctx.hh, 'mom', { challenge_id: c.id, number: c.number + 1, key: KEY })).status).toBe('wrong');
    expect(await ctx.store.get(Store.hk(ctx.hh), 'DEVKEY#robot-vacuum')).toBeUndefined();
  });
});

describe('after connecting', () => {
  it('Leo starts the vacuum; before it is connected the same ask is held', async () => {
    const before = await newHousehold();
    await speakAs(before.store, before.hh, 'leo', 'pin');
    expect((await requestAction(before.deps, before.hh, vac())).outcome).toBe('held');
    const ctx = await connected();
    await speakAs(ctx.store, ctx.hh, 'leo', 'pin');
    expect(await requestAction(ctx.deps, ctx.hh, vac())).toMatchObject({ outcome: 'allowed', done: true, reason: 'Okay. The vacuum is cleaning.' });
  });
  it('the camera is suggested ONCE, and stays off until an adult says Yes', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const r = await requestAction(ctx.deps, ctx.hh, connect);
    const c = (await getChallenge(ctx.deps, ctx.hh, r.job_id as string))!;
    const out = await phoneConfirm(ctx.deps, ctx.hh, 'mom', { challenge_id: c.id, number: c.number, key: KEY });
    expect(out.say).toContain('Want the hallway camera to check on it? Off until you say yes.');
    const sug = (await phoneInbox(ctx.deps, ctx.hh, 'mom')).suggestions;
    expect(sug).toEqual([{ id: 'camera', text: 'Want the hallway camera to check on it? Off until you say yes.' }]);
    expect((await phoneInbox(ctx.deps, ctx.hh, 'maya')).suggestions).toEqual([]); // adults only
    // off: nobody can use it, adults included
    const cam = home('camera', 'hallway');
    expect(await requestAction(ctx.deps, ctx.hh, cam)).toMatchObject({ outcome: 'denied', reason: 'The camera is off.' });
    await speakAs(ctx.store, ctx.hh, 'guest');
    expect((await requestAction(ctx.deps, ctx.hh, cam)).outcome).toBe('denied');
    // a teen cannot say Yes
    expect((await answerSuggestion(ctx.deps, ctx.hh, 'maya', 'camera', 'yes')).status).toBe('refused');
    expect((await loadHousehold(ctx.store, ctx.hh)).rules.cameraOn).toBeUndefined();
    // Mom says Yes: now adults can look (with a tap), others still cannot
    expect((await answerSuggestion(ctx.deps, ctx.hh, 'mom', 'camera', 'yes')).status).toBe('done');
    expect((await loadHousehold(ctx.store, ctx.hh)).rules.cameraOn).toBe(true);
    expect((await phoneInbox(ctx.deps, ctx.hh, 'mom')).suggestions).toEqual([]); // asked once
    expect((await answerSuggestion(ctx.deps, ctx.hh, 'mom', 'camera', 'yes')).status).toBe('refused'); // not twice
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const look = await requestAction(ctx.deps, ctx.hh, cam);
    expect(look).toMatchObject({ outcome: 'allowed', next: 'confirm_on_phone' });
    expect((await tap(ctx, 'mom', look.job_id as string)).say).toBe('Done. The hallway looks quiet.');
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    expect((await requestAction(ctx.deps, ctx.hh, cam)).outcome).toBe('denied');
    await speakAs(ctx.store, ctx.hh, 'guest');
    expect((await requestAction(ctx.deps, ctx.hh, cam)).outcome).toBe('denied');
  });
  it('saying No keeps the camera off for good', async () => {
    const ctx = await connected();
    expect((await answerSuggestion(ctx.deps, ctx.hh, 'mom', 'camera', 'no')).say).toBe('Okay. The camera stays off.');
    expect((await loadHousehold(ctx.store, ctx.hh)).rules.cameraOn).toBeUndefined();
    expect((await answerSuggestion(ctx.deps, ctx.hh, 'mom', 'camera', 'yes')).status).toBe('refused');
  });
  it('a $12 bag order needs Mom\'s tap; before the device is added it is held', async () => {
    const bag = { service: 'robot-vacuum', action: 'purchase', item: 'vacuum bag' };
    const before = await newHousehold();
    await speakAs(before.store, before.hh, 'mom', 'phone');
    expect((await requestAction(before.deps, before.hh, bag)).outcome).toBe('held');
    const ctx = await connected();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const r = await requestAction(ctx.deps, ctx.hh, bag);
    expect(r).toMatchObject({ outcome: 'allowed', amount_cents: 1200, next: 'confirm_on_phone' });
    await tap(ctx, 'mom', r.job_id as string);
    await ctx.queue.drain();
    const log = await readAudit(ctx.store, ctx.hh);
    expect(log.some((e) => /bought|Done/.test(e.text) && /1[0-9]|12/.test(e.text))).toBe(true);
  });
  it('health comes from the device: stuck or error tells the adults in one sentence, once per trouble', async () => {
    const ctx = await connected();
    await setVacuumStatus(ctx.store, ctx.hh, 'stuck');
    const a = await checkDevices(ctx.deps, ctx.hh);
    expect(a).toEqual([{ service: 'robot-vacuum', status: 'stuck', alerted: true }]);
    expect((await checkDevices(ctx.deps, ctx.hh))[0].alerted).toBe(false); // not again
    const notes = (await phoneInbox(ctx.deps, ctx.hh, 'mom')).notices.map((n) => n.text);
    expect(notes).toContain('The robot vacuum is stuck. Please check it.');
    await speakAs(ctx.store, ctx.hh, 'leo', 'pin');
    expect(await requestAction(ctx.deps, ctx.hh, vac())).toMatchObject({ outcome: 'held', reason: 'The vacuum is stuck. An adult was told.' });
    await setVacuumStatus(ctx.store, ctx.hh, 'idle');
    await checkDevices(ctx.deps, ctx.hh);
    await setVacuumStatus(ctx.store, ctx.hh, 'error');
    expect((await checkDevices(ctx.deps, ctx.hh))[0]).toMatchObject({ status: 'error', alerted: true });
  });
});

describe('review fixes', () => {
  it('a second card for the same device cannot overwrite the first adult\'s key; nothing is left behind when a card fails', async () => {
    const { deviceKey } = await import('../../src/devices/vault.js');
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const one = await requestAction(ctx.deps, ctx.hh, connect);
    const two = await requestAction(ctx.deps, ctx.hh, { ...connect, request_id: 'again' });
    const c1 = (await getChallenge(ctx.deps, ctx.hh, one.job_id as string))!;
    const c2 = (await getChallenge(ctx.deps, ctx.hh, two.job_id as string))!;
    expect((await phoneConfirm(ctx.deps, ctx.hh, 'mom', { challenge_id: c1.id, number: c1.number, key: KEY })).status).toBe('confirmed');
    const second = await phoneConfirm(ctx.deps, ctx.hh, 'mom', { challenge_id: c2.id, number: c2.number, key: 'another-key-1234' });
    expect(second.result?.done).not.toBe(true);
    expect(await deviceKey(ctx.store, ctx.hh, 'robot-vacuum')).toBe(KEY);
  });
});
