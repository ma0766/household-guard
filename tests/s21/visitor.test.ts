import { describe, expect, it } from 'vitest';
import { newHousehold, speakAs } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';
import { proposeRule } from '../../src/rules/change.js';
import { confirmIdentity, phoneInbox } from '../../src/identity/confirm.js';
import { startRuleSentence, StandInRuleParser } from '../../src/rules/sentence.js';
import { jobStatus } from '../../src/core/jobs.js';
import { loadHousehold } from '../../src/core/household.js';
import { Store } from '../../src/core/store.js';
import { home, ride, tap } from '../s20/helpers.js';

// the next time that is `weekday` (1 = Monday) at hour:minute in New York, counted from `from`
function at(from: number, weekday: number, hour: number, minute = 0): number {
  for (let t = Math.ceil(from / 60_000) * 60_000; t < from + 9 * 86400_000; t += 60_000) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    if (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1 === weekday && Number(p.hour) === hour && Number(p.minute) === minute) return t;
  }
  throw new Error('no such time');
}
const unlock = home('unlock', 'front door');

async function setup() {
  let t = Date.now();
  const ctx = await newHousehold({ now: () => t });
  await speakAs(ctx.store, ctx.hh, 'mom', 'phone', t);
  const r = await proposeRule(ctx.deps, ctx.hh, { change: { template: 'add_visitor', name: 'Dog walker', days: 'weekdays', fromHour: 12, toHour: 13 } });
  expect(r.status).toBe('waiting');
  expect(r.sentence).toBe('Dog walker can come in on weekdays from 12 PM to 1 PM.');
  const out = await tap(ctx, 'mom', r.challenge_id!);
  const pin = /PIN is (\d{4})/.exec(out.say)![1];
  const go = async (when: number) => {
    t = when;
    await ctx.store.delete(Store.hk(ctx.hh), 'SESSION#current');
    const c = await confirmIdentity(ctx.deps, ctx.hh, { name: 'Dog walker', pin });
    expect(c.status).toBe('confirmed');
  };
  return { ctx, pin, go, clock: (n: number) => (t = n) };
}

describe('visitors: let the dog walker in weekdays 12 to 1', () => {
  it('"let the dog walker in weekdays 12 to 1" is read as one setting', async () => {
    const p = new StandInRuleParser();
    const people = [{ id: 'mom', name: 'Mom', role: 'adult' }];
    expect(await p.parse('let the dog walker in weekdays 12 to 1', people)).toEqual({ change: { template: 'add_visitor', name: 'Dog walker', days: 'weekdays', fromHour: 12, toHour: 13 } });
    expect(await p.parse('Let the cleaner in weekends 9 to 5', people)).toEqual({ change: { template: 'add_visitor', name: 'Cleaner', days: 'weekends', fromHour: 9, toHour: 17 } });
    expect('question' in (await p.parse('let the dog walker in', people))).toBe(true);
    expect('question' in (await p.parse('let the dog walker in weekdays', people))).toBe(true);
  });
  it('typed by an adult it is read back with the try-it-first line and saved only after her tap', async () => {
    const ctx = await newHousehold({ ruleParser: new StandInRuleParser() });
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const s = await startRuleSentence(ctx.deps, ctx.hh, 'let the dog walker in weekdays 12 to 1');
    await ctx.queue.drain();
    const j: any = await jobStatus(ctx.deps, ctx.hh, s.job_id!);
    expect(j.readback).toContain('Dog walker can come in on weekdays from 12 PM to 1 PM.');
    expect((await loadHousehold(ctx.store, ctx.hh)).rules.visitors).toBeUndefined();
    await tap(ctx, 'mom', j.challenge_id);
    expect((await loadHousehold(ctx.store, ctx.hh)).rules.visitors?.[0]).toMatchObject({ id: 'v-dog-walker', fromHour: 12, toHour: 13, days: [1, 2, 3, 4, 5] });
  });
  it('only an adult can set it up; a teen, a child and a guest cannot', async () => {
    for (const [who, m] of [['maya', 'phone'], ['leo', 'pin'], ['guest', 'phone']] as const) {
      const ctx = await newHousehold();
      await speakAs(ctx.store, ctx.hh, who, m);
      expect((await proposeRule(ctx.deps, ctx.hh, { change: { template: 'add_visitor', name: 'Dog walker', days: 'weekdays', fromHour: 12, toHour: 13 } })).status, who).toBe('denied');
    }
  });
  it('bad windows are refused before the tap', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const bad = (c: object) => proposeRule(ctx.deps, ctx.hh, { change: { template: 'add_visitor', name: 'Dog walker', days: 'weekdays', fromHour: 12, toHour: 13, ...c } as any });
    for (const c of [{ fromHour: 13, toHour: 12 }, { fromHour: 0, toHour: 24 }, { days: 'sometimes' }, { name: 'Mom' }, { name: '' }]) expect((await bad(c)).status, JSON.stringify(c)).toBe('invalid');
  });
  it('let in at 12:30 on a weekday: the door opens, no tap', async () => {
    const { ctx, go } = await setup();
    await go(at(Date.now() + 86400_000, 2, 12, 30));
    expect(await requestAction(ctx.deps, ctx.hh, unlock)).toMatchObject({ outcome: 'allowed', done: true, person_name: 'Dog walker' });
  });
  it('refused at 3 PM, at 11:59, at 1:00 sharp, and on a Saturday; and an adult is told', async () => {
    const { ctx, go } = await setup();
    for (const when of [at(Date.now() + 86400_000, 3, 15), at(Date.now() + 86400_000, 3, 11, 59), at(Date.now() + 86400_000, 3, 13), at(Date.now() + 86400_000, 6, 12, 30)]) {
      await go(when);
      const r = await requestAction(ctx.deps, ctx.hh, unlock);
      expect(r.outcome, new Date(when).toISOString()).toBe('denied');
    }
    const notes = (await phoneInbox(ctx.deps, ctx.hh, 'mom')).notices.map((n) => n.text);
    expect(notes.some((n) => /Dog walker tried the door at the wrong time/.test(n))).toBe(true);
  });
  it('a visitor can do nothing but the door: no lights, garage, buying, orders, rules, or devices', async () => {
    const { ctx, go } = await setup();
    await go(at(Date.now() + 86400_000, 2, 12, 30));
    for (const a of [home('light', 'lights', 'on'), home('garage', 'garage'), home('weather'), home('music', 'jazz'), { service: 'mock-shop', action: 'order_history' }, ride('mall'), { service: 'devices', action: 'connect_device', item: 'robot vacuum' }]) {
      expect((await requestAction(ctx.deps, ctx.hh, a)).outcome, JSON.stringify(a)).toBe('denied');
    }
    expect((await proposeRule(ctx.deps, ctx.hh, { change: { template: 'weekly_limit', person: 'maya', cents: 99900 } })).status).toBe('denied');
  });
  it('the PIN is said only on Mom\'s phone, and an adult can end the visits', async () => {
    const { ctx, pin } = await setup();
    expect(JSON.stringify(await ctx.store.query(Store.hk(ctx.hh), 'AUDIT#'))).not.toContain(`"${pin}"`);
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const r = await proposeRule(ctx.deps, ctx.hh, { change: { template: 'end_visitor', id: 'v-dog-walker' } });
    await tap(ctx, 'mom', r.challenge_id!);
    await ctx.store.delete(Store.hk(ctx.hh), 'SESSION#current');
    expect((await confirmIdentity(ctx.deps, ctx.hh, { name: 'Dog walker', pin })).status).toBe('unknown');
  });
});
