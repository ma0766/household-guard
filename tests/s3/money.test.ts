import { describe, expect, it } from 'vitest';
import { newHousehold, speakAs } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';
import { requestActionOnce } from '../../src/core/idempotent.js';
import { phoneConfirm, phoneInbox } from '../../src/identity/confirm.js';
import { getChallenge } from '../../src/approvals/challenge.js';
import { jobStatus } from '../../src/core/jobs.js';
import { spentThisWeek } from '../../src/spend/spend.js';
import { weekKey } from '../../src/core/time.js';
import { countBookings, setRideState } from '../../src/connectors/mock-ride.js';
import { release } from '../../src/spend/spend.js';

const ride = (to: string, extra: Record<string, unknown> = {}) => ({ service: 'mock-ride', action: 'purchase', item: `ride to the ${to}`, ...extra });
const week = (now = Date.now()) => weekKey(now, 'America/New_York');

// request → tap the number on the person's own phone → wait for the worker
async function buy(ctx: Awaited<ReturnType<typeof newHousehold>>, who: 'maya' | 'mom', args: any) {
  const { hh, store, deps, queue } = ctx;
  await speakAs(store, hh, who);
  const r = await requestAction(deps, hh, args);
  if (r.next !== 'confirm_on_phone') return { r, job: undefined };
  const c = (await getChallenge(deps, hh, r.job_id as string))!;
  await phoneConfirm(deps, hh, who, { challenge_id: c.id, number: c.number });
  await queue.drain();
  return { r, job: await jobStatus(deps, hh, r.job_id as string) };
}

describe('S3 money: the ride', () => {
  it('teen $15 ride within her $20 cap → number on HER phone → worker books it → spend committed', async () => {
    const ctx = await newHousehold();
    const { r, job } = await buy(ctx, 'maya', ride('mall'));
    expect(r).toMatchObject({ outcome: 'allowed', done: false, amount_cents: 1500 });
    expect(job).toMatchObject({ status: 'done', say: 'Your ride is booked. $15 in all.' });
    expect(await spentThisWeek(ctx.store, ctx.hh, week(), 'maya')).toBe(1500);
    expect(await countBookings(ctx.store, ctx.hh)).toBe(1);
  });

  it("a teen's purchase pops a number on the teen's phone, not Mom's", async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya');
    const r = await requestAction(ctx.deps, ctx.hh, ride('mall'));
    expect((await phoneInbox(ctx.deps, ctx.hh, 'maya')).challenges.map((c) => c.id)).toContain(r.job_id);
    expect((await phoneInbox(ctx.deps, ctx.hh, 'mom')).challenges).toEqual([]);
    expect(await countBookings(ctx.store, ctx.hh)).toBe(0); // nothing booked until she taps
  });

  it('the price comes from the service, not from the caller', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya');
    const r = await requestAction(ctx.deps, ctx.hh, { ...ride('airport'), amount_cents: 100, price: 1, amount: 1 } as any);
    expect(r).toMatchObject({ outcome: 'held', amount_cents: 3800 });
  });

  it('$38 ride is over her $20 a week → held with the reason, nothing reserved', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya');
    const r = await requestAction(ctx.deps, ctx.hh, ride('airport'));
    expect(r).toMatchObject({ outcome: 'held', reason: "Held: over Maya's $20 a week." });
    expect(await spentThisWeek(ctx.store, ctx.hh, week(), 'maya')).toBe(0);
  });

  it('guest cannot buy; child needs an adult', async () => {
    const ctx = await newHousehold();
    expect(await requestAction(ctx.deps, ctx.hh, ride('mall'))).toMatchObject({ outcome: 'denied', reason: "Guests can't buy things." });
    const { setSession } = await import('../../src/core/household.js');
    await setSession(ctx.store, ctx.hh, 'leo', 'pin');
    expect(await requestAction(ctx.deps, ctx.hh, ride('school'))).toMatchObject({ outcome: 'held', reason: 'An adult must say yes to buys.' });
  });

  // ---- gap 4: two requests at once cannot beat the cap ----
  it('concurrency: two different $15 rides at the same instant against a $20 cap → one allowed, one held by the database', async () => {
    const ctx = await newHousehold();
    // both requests read "$0 spent" and both pass the rules; the barrier makes sure of it
    let arrived = 0;
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    ctx.deps.hooks = { beforeReserve: async () => { if (++arrived === 2) open(); await gate; } };
    await speakAs(ctx.store, ctx.hh, 'maya');
    const [a, b] = await Promise.all([requestAction(ctx.deps, ctx.hh, ride('mall')), requestAction(ctx.deps, ctx.hh, ride('library'))]);
    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(['allowed', 'held']);
    const held = a.outcome === 'held' ? a : b;
    expect(held.why).toBe('cap_race'); // held by the reservation, not by idempotency or the rules
    expect(held.reason).toBe("Held: over Maya's $20 a week.");
    expect(await spentThisWeek(ctx.store, ctx.hh, week(), 'maya')).toBe(1500);
  });

  // ---- gap 6: a retry books once ----
  it('duplicate: the same request sent twice (same request_id) → one ride', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya');
    const args = ride('mall', { request_id: 'alexa-retry-1' });
    const [a, b] = [await requestActionOnce(ctx.deps, ctx.hh, args), await requestActionOnce(ctx.deps, ctx.hh, args)];
    expect(b).toEqual(a);
    const c = (await getChallenge(ctx.deps, ctx.hh, a.job_id as string))!;
    await phoneConfirm(ctx.deps, ctx.hh, 'maya', { challenge_id: c.id, number: c.number });
    await phoneConfirm(ctx.deps, ctx.hh, 'maya', { challenge_id: c.id, number: c.number });
    await ctx.queue.drain();
    expect(await countBookings(ctx.store, ctx.hh)).toBe(1);
    expect(await spentThisWeek(ctx.store, ctx.hh, week(), 'maya')).toBe(1500);
  });

  it('duplicate in parallel: the same request_id at once → one reservation', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya');
    const args = ride('mall', { request_id: 'alexa-retry-2' });
    const out = await Promise.all([requestActionOnce(ctx.deps, ctx.hh, args), requestActionOnce(ctx.deps, ctx.hh, args), requestActionOnce(ctx.deps, ctx.hh, args)]);
    expect(out.filter((o) => o.outcome === 'allowed').length).toBe(1);
    expect(await spentThisWeek(ctx.store, ctx.hh, week(), 'maya')).toBe(1500);
  });

  it('duplicate with no request_id: same person, same words → still one', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya');
    const a = await requestActionOnce(ctx.deps, ctx.hh, ride('mall'));
    const b = await requestActionOnce(ctx.deps, ctx.hh, ride('mall'));
    expect(b).toEqual(a);
    expect(await spentThisWeek(ctx.store, ctx.hh, week(), 'maya')).toBe(1500);
  });

  it('worker failure releases the money', async () => {
    const ctx = await newHousehold();
    await setRideState(ctx.store, ctx.hh, { failBooking: true });
    const { job } = await buy(ctx, 'maya', ride('mall'));
    expect(job).toMatchObject({ status: 'failed', say: "I couldn't book it. You were not charged." });
    expect(await spentThisWeek(ctx.store, ctx.hh, week(), 'maya')).toBe(0);
    expect(await countBookings(ctx.store, ctx.hh)).toBe(0);
  });

  it('a yes nobody taps runs out, and the cap is free again', async () => {
    let t = Date.now();
    const ctx = await newHousehold({ now: () => t });
    await speakAs(ctx.store, ctx.hh, 'maya');
    await requestAction(ctx.deps, ctx.hh, ride('mall'));
    expect(await spentThisWeek(ctx.store, ctx.hh, week(t), 'maya')).toBe(1500);
    t += 11 * 60_000;
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone', t); // session ended; sign in again
    const again = await requestAction(ctx.deps, ctx.hh, ride('library'));
    expect(again.outcome).toBe('allowed');
    expect(await spentThisWeek(ctx.store, ctx.hh, week(t), 'maya')).toBe(1500);
  });

  it('release is safe to call twice (never gives money back twice)', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya');
    await requestAction(ctx.deps, ctx.hh, ride('mall'));
    const { Store } = await import('../../src/core/store.js');
    const res = (await ctx.store.query(Store.hk(ctx.hh), 'RES#'))[0];
    expect(await release(ctx.store, ctx.hh, res.id)).toBe(true);
    expect(await release(ctx.store, ctx.hh, res.id)).toBe(false);
    expect(await spentThisWeek(ctx.store, ctx.hh, week(), 'maya')).toBe(0);
  });

  it('a DynamoDB error in the money path gives hold, never allowed', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya');
    ctx.deps.hooks = { beforeReserve: async () => { throw new Error('boom'); } };
    const r = await requestAction(ctx.deps, ctx.hh, ride('mall'));
    expect(r.outcome).toBe('held');
    expect(await spentThisWeek(ctx.store, ctx.hh, week(), 'maya')).toBe(0);
  });
});

describe('S3 idempotency stores any result shape', () => {
  it('a purchase with no option (undefined fields) is still remembered, not turned into "busy"', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya');
    const r = await requestActionOnce(ctx.deps, ctx.hh, { service: 'mock-shop', action: 'purchase', item: 'book', request_id: 'shape-1' });
    expect(r).toMatchObject({ outcome: 'allowed', next: 'confirm_on_phone' });
    expect(await requestActionOnce(ctx.deps, ctx.hh, { service: 'mock-shop', action: 'purchase', item: 'book', request_id: 'shape-1' })).toEqual(r);
  });
});
