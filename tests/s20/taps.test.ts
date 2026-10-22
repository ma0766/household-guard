import { describe, expect, it } from 'vitest';
import { newHousehold, speakAs } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';
import { proposeRule } from '../../src/rules/change.js';
import { loadHousehold } from '../../src/core/household.js';
import { tapCovers } from '../../src/identity/tapwindow.js';
import { readAudit } from '../../src/audit/audit.js';
import { home, ride, tap } from './helpers.js';

// Taps only for what matters.
describe('no tap for everyday things', () => {
  it('lights, music, weather, timers, the heat in range: done at once, for a teen and a guest-free house', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    for (const a of [home('light', 'lights', 'off'), home('music', 'jazz'), home('weather'), home('timer', 'timer', 5), home('thermostat', 'thermostat', 72)]) {
      const r = await requestAction(ctx.deps, ctx.hh, a);
      expect(r, JSON.stringify(a)).toMatchObject({ outcome: 'allowed', done: true });
      expect(r.next).toBeUndefined();
    }
  });
  it('a timer needs a real number of minutes; the heat out of range waits for an adult', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    expect((await requestAction(ctx.deps, ctx.hh, home('timer', 'timer', 0))).outcome).toBe('denied');
    expect((await requestAction(ctx.deps, ctx.hh, home('timer', 'timer', 'soon'))).outcome).toBe('denied');
    expect((await requestAction(ctx.deps, ctx.hh, home('thermostat', 'thermostat', 95))).outcome).toBe('held');
  });
  it('the garage: adults and teens at once with a spoken heads-up; children never', async () => {
    const ctx = await newHousehold();
    for (const who of ['mom', 'maya'] as const) {
      await speakAs(ctx.store, ctx.hh, who, 'phone');
      const r = await requestAction(ctx.deps, ctx.hh, home('garage', 'garage'));
      expect(r).toMatchObject({ outcome: 'allowed', done: true });
      expect(r.say).toMatch(/^Heads up/);
    }
    await speakAs(ctx.store, ctx.hh, 'leo', 'pin');
    expect((await requestAction(ctx.deps, ctx.hh, home('garage', 'garage'))).outcome).toBe('denied');
  });
});

describe('a phone tap for what matters', () => {
  it('unlocking a door always asks for the adult\'s own tap, even right after another tap', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const b = await requestAction(ctx.deps, ctx.hh, ride('mall'));
    expect(b.next).toBe('confirm_on_phone');
    await tap(ctx, 'mom', b.job_id as string);
    const u = await requestAction(ctx.deps, ctx.hh, home('unlock', 'front door'));
    expect(u).toMatchObject({ outcome: 'allowed', done: false, next: 'confirm_on_phone' });
  });
  it('changing a rule always asks for the adult\'s own tap (nothing is saved before it)', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const r = await proposeRule(ctx.deps, ctx.hh, { change: { template: 'weekly_limit', person: 'maya', cents: 3000 } });
    expect(r.status).toBe('waiting');
    expect((await loadHousehold(ctx.store, ctx.hh)).rules.weeklyCapCents.maya).toBe(2000);
  });
  it('the first buy asks for a tap; one tap then covers that person for 5 minutes, inside their limits', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    const first = await requestAction(ctx.deps, ctx.hh, ride('school', 'shared')); // $6
    expect(first).toMatchObject({ outcome: 'allowed', next: 'confirm_on_phone' });
    expect((await tap(ctx, 'maya', first.job_id as string)).result?.done).toBe(false); // a job was queued
    expect(await tapCovers(ctx.store, ctx.hh, 'maya', Date.now())).toBe(true);
    const second = await requestAction(ctx.deps, ctx.hh, ride('school', 'shared')); // $6 more: $12 of $20
    expect(second.outcome).toBe('allowed');
    expect(second.next).toBeUndefined(); // no second tap
    expect(second.tap).toBe('not_needed_covered');
    await ctx.queue.drain();
    // still inside the limits: a big one is held, tap or no tap
    expect((await requestAction(ctx.deps, ctx.hh, ride('airport'))).outcome).toBe('held');
  });
  it('the 5 minutes end: after that a buy asks for a tap again', async () => {
    let t = Date.now();
    const ctx = await newHousehold({ now: () => t });
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone', t);
    const first = await requestAction(ctx.deps, ctx.hh, ride('mall'));
    await tap(ctx, 'mom', first.job_id as string);
    expect(await tapCovers(ctx.store, ctx.hh, 'mom', t + 4 * 60_000)).toBe(true);
    t += 6 * 60_000;
    expect(await tapCovers(ctx.store, ctx.hh, 'mom', t)).toBe(false);
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone', t); // she says who she is again
    const again = await requestAction(ctx.deps, ctx.hh, ride('mall'));
    expect(again).toMatchObject({ outcome: 'allowed', next: 'confirm_on_phone' });
  });
  it('the tap covers only that person: Mom\'s tap does not cover Maya', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const first = await requestAction(ctx.deps, ctx.hh, ride('mall'));
    await tap(ctx, 'mom', first.job_id as string);
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    const m = await requestAction(ctx.deps, ctx.hh, ride('school', 'shared'));
    expect(m).toMatchObject({ outcome: 'allowed', next: 'confirm_on_phone' });
  });
});

describe('the no-tap list for small buys (off by default)', () => {
  it('off by default: a small buy still asks for a tap', async () => {
    const ctx = await newHousehold();
    expect((await loadHousehold(ctx.store, ctx.hh)).rules.noTapBuyCents).toBeUndefined();
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    expect((await requestAction(ctx.deps, ctx.hh, ride('school', 'shared'))).next).toBe('confirm_on_phone');
  });
  it('Mom puts Maya on it for $10 (her tap saves it): a $6 ride needs no tap, a $15 one does, and over the limit it is still held', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const r = await proposeRule(ctx.deps, ctx.hh, { change: { template: 'no_tap_buys', person: 'maya', cents: 1000 } });
    expect(r.status).toBe('waiting');
    expect(r.warning).toMatch(/no tap/);
    expect((await loadHousehold(ctx.store, ctx.hh)).rules.noTapBuyCents).toBeUndefined(); // not before the tap
    await tap(ctx, 'mom', r.challenge_id!);
    expect((await loadHousehold(ctx.store, ctx.hh)).rules.noTapBuyCents).toEqual({ maya: 1000 });

    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    const small = await requestAction(ctx.deps, ctx.hh, ride('school', 'shared')); // $6
    expect(small).toMatchObject({ outcome: 'allowed', tap: 'not_needed_small' });
    expect(small.next).toBeUndefined();
    // a $15 ride is over her $10 no-tap line (fresh week, so the limit is not the reason)
    const other = await newHousehold();
    await other.store.put({ pk: (await import('../../src/core/store.js')).Store.hk(other.hh), sk: 'RULES#current', config: { ...(await loadHousehold(ctx.store, ctx.hh)).rules } });
    await speakAs(other.store, other.hh, 'maya', 'phone');
    expect((await requestAction(other.deps, other.hh, ride('mall'))).next).toBe('confirm_on_phone');
  });
  it('a teen cannot put themselves on the list', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    const r = await proposeRule(ctx.deps, ctx.hh, { change: { template: 'no_tap_buys', person: 'maya', cents: 5000 } });
    expect(r.status).toBe('denied');
  });
  it('only $1 to $50 can be set', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    expect((await proposeRule(ctx.deps, ctx.hh, { change: { template: 'no_tap_buys', person: 'maya', cents: 9000 } })).status).toBe('invalid');
  });
  it('the log says nothing about taps skipped being secret: the ask is logged like any other', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    await requestAction(ctx.deps, ctx.hh, home('light', 'lights', 'off'));
    expect((await readAudit(ctx.store, ctx.hh))[0].text).toMatch(/Mom asked to turn the lights off/);
  });
});
