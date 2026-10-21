import { describe, expect, it } from 'vitest';
import { newHousehold, speakAs } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';
import { applyChange } from '../../src/rules/templates.js';
import { defaultRules, type RulesConfig } from '../../src/policy/rules.js';
import { DEMO_PEOPLE } from '../../src/core/household.js';
import { Store } from '../../src/core/store.js';
import { T } from '../../src/text.js';

const mall = { service: 'mock-ride', action: 'purchase', item: 'ride to the mall' };
const quiet = { ...defaultRules(), quietHours: { fromHour: 21, toHour: 6 } };
// 2026-10-21 in UTC → New York is 4 hours behind (daylight time)
const ny = (hhmm: string) => Date.parse(`2026-10-21T${hhmm}:00-04:00`);

async function house(rules: RulesConfig = quiet, tz?: string) {
  const ctx = await newHousehold();
  await ctx.store.put({ pk: Store.hk(ctx.hh), sk: 'RULES#current', config: rules });
  if (tz) await ctx.store.update({ Key: { pk: Store.hk(ctx.hh), sk: 'META' }, UpdateExpression: 'SET #tz = :z', ExpressionAttributeNames: { '#tz': 'timezone' }, ExpressionAttributeValues: { ':z': tz } });
  return ctx;
}
const ask = async (ctx: Awaited<ReturnType<typeof house>>, who: 'maya' | 'mom', at: number) => {
  const deps = { ...ctx.deps, now: () => at };
  await speakAs(ctx.store, ctx.hh, who, 'phone', at);
  return requestAction(deps, ctx.hh, mall);
};

describe('S10 quiet hours (no buying after 9 PM, in the house time zone)', () => {
  it('a teen is refused at 9:30 PM with the reason, and allowed at 8 PM', async () => {
    const ctx = await house();
    const late = await ask(ctx, 'maya', ny('21:30'));
    expect(late).toMatchObject({ outcome: 'denied', done: false });
    expect(late.reason).toBe(T.quietHours(21, 6));
    expect(late.reason).toBe('Quiet hours: no buying from 9 PM to 6 AM.');
    expect((await ask(ctx, 'maya', ny('20:00'))).outcome).toBe('allowed');
  });
  it('the edges: 8:59 PM is fine, 9:00 PM is not; 5:59 AM is not, 6:00 AM is fine', async () => {
    // a fresh house each time: an allowed buy reserves money, and that would change the next answer
    expect((await ask(await house(), 'maya', ny('20:59'))).outcome).toBe('allowed');
    expect((await ask(await house(), 'maya', ny('21:00'))).outcome).toBe('denied');
    expect((await ask(await house(), 'maya', ny('05:59'))).outcome).toBe('denied');
    expect((await ask(await house(), 'maya', ny('06:00'))).outcome).toBe('allowed');
  });
  it('adults are not held to quiet hours', async () => {
    const ctx = await house();
    expect((await ask(ctx, 'mom', ny('23:30'))).outcome).toBe('allowed');
  });
  it('the hour is the house\'s own: 9:30 PM in New York is 10:30 AM in Tokyo, so a Tokyo house may buy', async () => {
    const tokyo = await house(quiet, 'Asia/Tokyo');
    expect((await ask(tokyo, 'maya', ny('21:30'))).outcome).toBe('allowed');
    const nyc = await house();
    expect((await ask(nyc, 'maya', ny('21:30'))).outcome).toBe('denied');
  });
  it('a window that does not cross midnight works too (1 AM to 5 AM)', async () => {
    const ctx = await house({ ...defaultRules(), quietHours: { fromHour: 1, toHour: 5 } });
    expect((await ask(ctx, 'maya', ny('03:00'))).outcome).toBe('denied');
    expect((await ask(ctx, 'maya', ny('23:00'))).outcome).toBe('allowed');
  });
  it('off by default', async () => {
    const ctx = await house(defaultRules());
    expect((await ask(ctx, 'maya', ny('23:30'))).outcome).toBe('allowed');
  });
});

describe('S10 the quiet hours card', () => {
  it('turns on, changes and turns off; bad hours are refused before saving', () => {
    const on = applyChange(defaultRules(), { template: 'quiet_hours', fromHour: 21, toHour: 6 }, DEMO_PEOPLE);
    expect(on).toMatchObject({ ok: true, sentence: 'No buying for kids from 9 PM to 6 AM.' });
    if (!on.ok) return;
    expect(on.config.quietHours).toEqual({ fromHour: 21, toHour: 6 });
    const cfg: RulesConfig = on.config;
    const off = applyChange(cfg, { template: 'quiet_hours', fromHour: null }, DEMO_PEOPLE);
    expect(off).toMatchObject({ ok: true, sentence: 'Quiet hours are off.' });
    if (off.ok) expect(off.config.quietHours).toBeUndefined();
    for (const bad of [{ fromHour: 25, toHour: 6 }, { fromHour: 21, toHour: -1 }, { fromHour: 21.5, toHour: 6 }, { fromHour: 8, toHour: 8 }]) {
      expect(applyChange(defaultRules(), { template: 'quiet_hours', ...bad }, DEMO_PEOPLE).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('S10 quiet hours are checked again when the buy happens', () => {
  it('allowed at 8:59 PM, tapped at 9:01 PM: not booked, money released, the reason is given', async () => {
    const ctx = await house();
    const early = ny('20:59');
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone', early);
    const r = await requestAction({ ...ctx.deps, now: () => early }, ctx.hh, mall);
    expect(r).toMatchObject({ outcome: 'allowed', next: 'confirm_on_phone' });
    const late = ny('21:01');
    const lateDeps = { ...ctx.deps, now: () => late };
    const c = (await (await import('../../src/approvals/challenge.js')).getChallenge(lateDeps, ctx.hh, r.job_id as string))!;
    await (await import('../../src/identity/confirm.js')).phoneConfirm(lateDeps, ctx.hh, 'maya', { challenge_id: c.id, number: c.number });
    await ctx.queue.drain();
    const { jobStatus } = await import('../../src/core/jobs.js');
    expect(await jobStatus(lateDeps, ctx.hh, r.job_id as string)).toMatchObject({ status: 'failed', say: 'Quiet hours: no buying from 9 PM to 6 AM.' });
    const { countBookings } = await import('../../src/connectors/mock-ride.js');
    expect(await countBookings(ctx.store, ctx.hh)).toBe(0);
    const { spentThisWeek } = await import('../../src/spend/spend.js');
    const { weekKey } = await import('../../src/core/time.js');
    expect(await spentThisWeek(ctx.store, ctx.hh, weekKey(late, 'America/New_York'), 'maya')).toBe(0);
  });
  it('held at 8:59 PM, Mom says yes at 9:05 PM: still not booked (no yes overrides quiet hours)', async () => {
    const ctx = await house();
    const early = ny('20:59');
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone', early);
    const held = await requestAction({ ...ctx.deps, now: () => early }, ctx.hh, { service: 'mock-ride', action: 'purchase', item: 'ride to the airport' });
    expect(held.outcome).toBe('held');
    const late = ny('21:05');
    const lateDeps = { ...ctx.deps, now: () => late };
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone', late);
    const { approveRequest, getApproval } = await import('../../src/approvals/approvals.js');
    const a = (await getApproval(lateDeps, ctx.hh, held.approval_id as string))!;
    const ok = await approveRequest(lateDeps, ctx.hh, 'mom', a.id, { number: a.number, method: 'phone' });
    expect(ok.status).toBe('approved'); // the yes itself is fine; it is the buying that quiet hours stop
    await ctx.queue.drain();
    const { countBookings } = await import('../../src/connectors/mock-ride.js');
    expect(await countBookings(ctx.store, ctx.hh)).toBe(0);
    const { jobStatus } = await import('../../src/core/jobs.js');
    expect(await jobStatus(lateDeps, ctx.hh, ok.job_id!)).toMatchObject({ status: 'failed', say: 'Quiet hours: no buying from 9 PM to 6 AM.' });
  });
});
