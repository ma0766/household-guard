import { describe, expect, it } from 'vitest';
import { newHousehold, speakAs } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';
import { proposeRule } from '../../src/rules/change.js';
import { confirmIdentity } from '../../src/identity/confirm.js';
import { loadHousehold, setSession } from '../../src/core/household.js';
import { readAudit } from '../../src/audit/audit.js';
import { Store } from '../../src/core/store.js';
import { home, ride, tap, type Ctx } from './helpers.js';

const day = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
async function mom(ctx: Ctx, change: Parameters<typeof proposeRule>[2]['change']) {
  await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
  const r = await proposeRule(ctx.deps, ctx.hh, { change });
  expect(r.status, JSON.stringify(r)).toBe('waiting');
  return tap(ctx, 'mom', r.challenge_id!);
}
async function addSam(ctx: Ctx, allowed = ['light', 'music'], until = day(Date.now() + 3 * 86400_000)) {
  const out = await mom(ctx, { template: 'add_guest', name: 'Sam', allowed, until });
  const pin = /PIN is (\d{4})/.exec(out.say)?.[1];
  return { out, pin: pin! };
}

describe('the guest switch: Everyday things for anyone at home', () => {
  it('on by default: someone nobody confirmed can turn on a light', async () => {
    const ctx = await newHousehold();
    expect((await loadHousehold(ctx.store, ctx.hh)).rules.guestEveryday).toBeUndefined();
    expect(await requestAction(ctx.deps, ctx.hh, home('light', 'lights', 'on'))).toMatchObject({ outcome: 'allowed', done: true });
  });
  it('off: every request needs a PIN or a tap; confirmed people are not slowed', async () => {
    const ctx = await newHousehold();
    const out = await mom(ctx, { template: 'guest_switch', enabled: false });
    expect(out.result?.done).toBe(true);
    await ctx.store.delete(Store.hk(ctx.hh), 'SESSION#current');
    for (const a of [home('light', 'lights', 'on'), home('music', 'jazz'), home('weather'), home('timer', 'timer', 5), home('thermostat', 'thermostat', 72), home('garage', 'garage')]) {
      const r = await requestAction(ctx.deps, ctx.hh, a);
      expect(r.outcome, JSON.stringify(a)).toBe('denied');
      expect(r.say).toMatch(/PIN or tap your phone/);
      expect(r.rule).toBe('Rule: everyday things need a PIN or a tap.');
    }
    await speakAs(ctx.store, ctx.hh, 'leo', 'pin');
    expect((await requestAction(ctx.deps, ctx.hh, home('light', 'lights', 'on'))).done).toBe(true);
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    expect((await requestAction(ctx.deps, ctx.hh, home('music', 'jazz'))).done).toBe(true);
  });
  it('turning it back on needs the adult\'s tap and warns first; undo works', async () => {
    const ctx = await newHousehold();
    await mom(ctx, { template: 'guest_switch', enabled: false });
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const on = await proposeRule(ctx.deps, ctx.hh, { change: { template: 'guest_switch', enabled: true } });
    expect(on.warning).toMatch(/lets anyone at home/);
    await tap(ctx, 'mom', on.challenge_id!);
    expect((await loadHousehold(ctx.store, ctx.hh)).rules.guestEveryday).toBe(true);
  });
});

describe('named guests: their own PIN, their own list, an end date', () => {
  it('Mom adds Sam; his PIN is told only on her phone; Sam can do his list and nothing else', async () => {
    const ctx = await newHousehold();
    const { out, pin } = await addSam(ctx);
    expect(pin).toMatch(/^\d{4}$/);
    // the PIN is said once, to the tapper; it is not in the saved answer, the log, the rules, or any record
    expect(JSON.stringify(out.result)).not.toContain(pin);
    for (const prefix of ['CHAL#', 'AUDIT#', 'RULECHG#', 'RULES#', 'PERSON#', 'NOTICE#']) expect(JSON.stringify(await ctx.store.query(Store.hk(ctx.hh), prefix)), prefix).not.toContain(`"${pin}"`);
    expect((await ctx.store.get(Store.hk(ctx.hh), 'PERSON#g-sam'))?.pinHash).toMatch(/^scrypt/);

    await ctx.store.delete(Store.hk(ctx.hh), 'SESSION#current');
    expect((await confirmIdentity(ctx.deps, ctx.hh, { name: 'Sam', pin })).status).toBe('confirmed');
    expect(await requestAction(ctx.deps, ctx.hh, home('light', 'lights', 'off'))).toMatchObject({ outcome: 'allowed', done: true });
    expect(await requestAction(ctx.deps, ctx.hh, home('music', 'jazz'))).toMatchObject({ outcome: 'allowed', done: true });
    const no = await requestAction(ctx.deps, ctx.hh, home('thermostat', 'thermostat', 72)); // not on his list
    expect(no.outcome).toBe('denied');
    expect(no.rule).toBe("Rule: Sam's list does not have that.");
    expect(no.person_name).toBe('Sam');
  });
  it('the guest record expires by itself (3 days past the last day), and the privacy note says an adult makes it', async () => {
    const ctx = await newHousehold();
    const until = day(Date.now() + 3 * 86400_000);
    await addSam(ctx, ['light'], until);
    const row = await ctx.store.get(Store.hk(ctx.hh), 'PERSON#g-sam');
    expect(row?.ttl).toBeGreaterThan(Math.floor((Date.now() + 5 * 86400_000) / 1000));
    expect(row?.ttl).toBeLessThan(Math.floor((Date.now() + 8 * 86400_000) / 1000));
    const { PRIVACY } = await import('../../src/server.js');
    expect(PRIVACY).toMatch(/guest profile is made only by an adult/i);
  });
  it('a guest past their last day also leaves the rules at the next change', async () => {
    let t = Date.now();
    const ctx = await newHousehold({ now: () => t });
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone', t);
    const r = await proposeRule(ctx.deps, ctx.hh, { change: { template: 'add_guest', name: 'Sam', allowed: ['light'], until: day(t + 86400_000) } });
    await tap(ctx, 'mom', r.challenge_id!);
    t += 4 * 86400_000;
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone', t);
    const g = await proposeRule(ctx.deps, ctx.hh, { change: { template: 'guest_switch', enabled: false } });
    await tap(ctx, 'mom', g.challenge_id!);
    expect((await loadHousehold(ctx.store, ctx.hh, t)).rules.guests).toBeUndefined();
  });
  it('a very long name still gets a PIN (the name is cut the same way everywhere)', async () => {
    const ctx = await newHousehold();
    const out = await mom(ctx, { template: 'add_guest', name: 'Maximilianalexanderson', allowed: ['light'], until: day(Date.now() + 86400_000) });
    const pin = /PIN is (\d{4})/.exec(out.say)?.[1];
    expect(pin).toBeTruthy();
    await ctx.store.delete(Store.hk(ctx.hh), 'SESSION#current');
    expect((await confirmIdentity(ctx.deps, ctx.hh, { name: 'Maximilianalexanders', pin: pin! })).status).toBe('confirmed');
  });
  it('a late buy tap does not move who is speaking back to the tapper', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const first = await requestAction(ctx.deps, ctx.hh, ride('mall'));
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone'); // Maya speaks after Mom
    await tap(ctx, 'mom', first.job_id as string); // Mom's old tap lands late
    const r = await requestAction(ctx.deps, ctx.hh, { service: 'mock-shop', action: 'order_history' });
    expect(r.outcome).toBe('denied'); // still Maya speaking: no orders for a teen
    expect(r.say).toBe("That's private. Ask a grown-up.");
  });
  it('a wrong PIN does nothing, and three wrong tries lock', async () => {
    const ctx = await newHousehold();
    const { pin } = await addSam(ctx);
    const wrong = pin === '1234' ? '4321' : '1234';
    expect((await confirmIdentity(ctx.deps, ctx.hh, { name: 'Sam', pin: wrong })).status).toBe('failed');
    expect((await confirmIdentity(ctx.deps, ctx.hh, { name: 'Sam', pin: wrong })).status).toBe('failed');
    expect((await confirmIdentity(ctx.deps, ctx.hh, { name: 'Sam', pin: wrong })).status).toBe('locked');
    expect((await confirmIdentity(ctx.deps, ctx.hh, { name: 'Sam', pin })).status).toBe('locked');
  });
  it('the end date switches the guest off by itself: no new sign-in, and the old one stops working', async () => {
    let t = Date.now();
    const ctx = await newHousehold({ now: () => t });
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone', t);
    const r = await proposeRule(ctx.deps, ctx.hh, { change: { template: 'add_guest', name: 'Sam', allowed: ['light'], until: day(t + 2 * 86400_000) } });
    const out = await tap(ctx, 'mom', r.challenge_id!);
    const pin = /PIN is (\d{4})/.exec(out.say)![1];
    await ctx.store.delete(Store.hk(ctx.hh), 'SESSION#current');
    expect((await confirmIdentity(ctx.deps, ctx.hh, { name: 'Sam', pin })).status).toBe('confirmed');
    expect((await requestAction(ctx.deps, ctx.hh, home('light', 'lights', 'on'))).person_name).toBe('Sam');
    t += 3 * 86400_000; // past the last day
    await setSession(ctx.store, ctx.hh, 'g-sam', 'pin', t); // even a session that somehow still exists...
    const after = await requestAction(ctx.deps, ctx.hh, home('light', 'lights', 'on'));
    expect(after.person_name).toBe('Guest'); // ...is a plain guest again, not Sam
    await ctx.store.delete(Store.hk(ctx.hh), 'SESSION#current');
    expect((await confirmIdentity(ctx.deps, ctx.hh, { name: 'Sam', pin })).status).toBe('unknown');
    expect((await loadHousehold(ctx.store, ctx.hh, t)).people.map((p) => p.id)).not.toContain('g-sam');
  });
  it('the last day counts all day (through that night in the house\'s own zone)', async () => {
    const ctx = await newHousehold();
    const { endOfDayMs } = await import('../../src/rules/templates.js');
    const end = endOfDayMs(2026, 10, 30, 'America/New_York');
    expect(new Date(end).toISOString()).toBe('2026-10-31T03:59:59.000Z'); // 11:59:59 PM EDT
    expect(ctx.hh).toBeTruthy();
  });
  it('bad dates and lists are refused before the tap', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const bad = (c: any) => proposeRule(ctx.deps, ctx.hh, { change: { template: 'add_guest', name: 'Sam', allowed: ['light'], until: day(Date.now() + 86400_000), ...c } });
    expect((await bad({ until: day(Date.now() - 3 * 86400_000) })).status).toBe('invalid');
    expect((await bad({ until: 'someday' })).status).toBe('invalid');
    expect((await bad({ until: day(Date.now() + 800 * 86400_000) })).status).toBe('invalid');
    expect((await bad({ allowed: ['unlock'] })).status).toBe('invalid');
    expect((await bad({ allowed: ['purchase'] })).status).toBe('invalid');
    expect((await bad({ name: 'Mom' })).status).toBe('invalid'); // someone already has that name
    expect((await bad({ name: '' })).status).toBe('invalid');
  });
  it('a guest, a teen or a child cannot add a guest', async () => {
    const ctx = await newHousehold();
    for (const who of ['maya', 'leo', 'guest'] as const) {
      await speakAs(ctx.store, ctx.hh, who, who === 'leo' ? 'pin' : 'phone');
      const r = await proposeRule(ctx.deps, ctx.hh, { change: { template: 'add_guest', name: 'Sam', allowed: ['light'], until: day(Date.now() + 86400_000) } });
      expect(r.status).toBe('denied');
    }
    expect((await loadHousehold(ctx.store, ctx.hh)).rules.guests).toBeUndefined();
  });
  it('Mom ends a stay early; undo brings the guest back (with the same PIN)', async () => {
    const ctx = await newHousehold();
    const { pin } = await addSam(ctx);
    await mom(ctx, { template: 'end_guest', id: 'g-sam' });
    await ctx.store.delete(Store.hk(ctx.hh), 'SESSION#current');
    expect((await confirmIdentity(ctx.deps, ctx.hh, { name: 'Sam', pin })).status).toBe('unknown');
    // undo (Mom taps again): the stay is back, and so is his PIN
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const u = await proposeRule(ctx.deps, ctx.hh, { undo: true });
    expect(u.status).toBe('waiting');
    await tap(ctx, 'mom', u.challenge_id!);
    await ctx.store.delete(Store.hk(ctx.hh), 'SESSION#current');
    expect((await confirmIdentity(ctx.deps, ctx.hh, { name: 'Sam', pin })).status).toBe('confirmed');
  });
  it('guests never spend without an adult, unlock, change rules or hear orders: named or not', async () => {
    const ctx = await newHousehold();
    await addSam(ctx, ['light', 'thermostat', 'music', 'weather', 'timer']);
    for (const who of ['guest', 'g-sam']) {
      if (who === 'guest') await ctx.store.delete(Store.hk(ctx.hh), 'SESSION#current');
      else await setSession(ctx.store, ctx.hh, 'g-sam', 'pin');
      expect((await requestAction(ctx.deps, ctx.hh, ride('mall'))).outcome, who).toBe('denied');
      expect((await requestAction(ctx.deps, ctx.hh, { service: 'mock-shop', action: 'purchase', item: 'gift card' })).outcome, who).toBe('denied');
      expect((await requestAction(ctx.deps, ctx.hh, home('unlock', 'front door'))).outcome, who).toBe('denied');
      expect((await requestAction(ctx.deps, ctx.hh, home('garage', 'garage'))).outcome, who).toBe('denied');
      for (const a of ['order_history', 'order_status', 'cart']) {
        const r = await requestAction(ctx.deps, ctx.hh, { service: 'mock-shop', action: a });
        expect(r.outcome, `${who} ${a}`).toBe('denied');
        expect(r.say).toBe("That's private. Ask a grown-up.");
        expect(JSON.stringify(r)).not.toMatch(/lego|castle|soccer|paper|charger/i);
      }
      expect((await proposeRule(ctx.deps, ctx.hh, { change: { template: 'weekly_limit', person: 'maya', cents: 99900 } })).status, who).toBe('denied');
      expect((await requestAction(ctx.deps, ctx.hh, { service: 'mock-shop', action: 'mark_gift', item: 'book' })).outcome, who).toBe('denied');
    }
    expect(JSON.stringify(await readAudit(ctx.store, ctx.hh))).not.toMatch(/lego|castle|soccer|paper towels|charger/i);
  });
});
