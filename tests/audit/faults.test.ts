import { describe, expect, it } from 'vitest';
import { newHousehold, speakAs } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';
import { phoneConfirm } from '../../src/identity/confirm.js';
import { getChallenge } from '../../src/approvals/challenge.js';
import { jobStatus } from '../../src/core/jobs.js';
import { countBookings } from '../../src/connectors/mock-ride.js';
import { Store } from '../../src/core/store.js';
import { localClient } from '../../src/core/local-dynamo.js';
import type { RiskChecker } from '../../src/risk/risk.js';

// Audit Part E: force DynamoDB, SQS and Bedrock to fail ONE AT A TIME. Every path must hold or deny, never allow-and-do.
const ride = { service: 'mock-ride', action: 'purchase', item: 'ride to the mall' };
const unlock = { service: 'sim-home', action: 'unlock', item: 'front door' };
const lights = { service: 'sim-home', action: 'light', item: 'lights', value: 'off' };
const doneAllowed = (r: any) => r.outcome === 'allowed' && r.done === true;

describe('Part E: one failing dependency at a time', () => {
  it('DynamoDB fails on every call → no request is allowed-and-done', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom');
    for (const m of ['get', 'put', 'query', 'update', 'transact', 'delete'] as const) {
      const real = (ctx.store as any)[m]?.bind(ctx.store);
      if (real) (ctx.store as any)[m] = async () => { throw new Error('ddb down'); };
    }
    for (const args of [lights, unlock, ride, { service: 'mock-shop', action: 'purchase', item: 'gift card' }]) {
      let r: any;
      try { r = await requestAction(ctx.deps, ctx.hh, args); } catch { r = { outcome: 'threw' }; } // a throw is an error the caller sees: not an allow
      expect(doneAllowed(r), JSON.stringify(args)).toBe(false);
    }
    expect(await countBookings(new Store(localClient()), ctx.hh)).toBe(0); // a fresh, healthy store counts rides
  });

  it('SQS send fails → the ride is not booked and the person is not told it was', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya');
    (ctx.deps.queue as any).send = async () => { throw new Error('sqs down'); };
    const r: any = await requestAction(ctx.deps, ctx.hh, ride);
    expect(doneAllowed(r)).toBe(false);
    if (r.next === 'confirm_on_phone') {
      const c = (await getChallenge(ctx.deps, ctx.hh, r.job_id))!;
      try { await phoneConfirm(ctx.deps, ctx.hh, 'maya', { challenge_id: c.id, number: c.number }); } catch { /* a throw here is also not a booking */ }
      const job: any = await jobStatus(ctx.deps, ctx.hh, r.job_id);
      expect(job.status).not.toBe('done');
    }
    expect(await countBookings(new Store(localClient()), ctx.hh)).toBe(0); // a fresh, healthy store counts rides
  });

  it('Bedrock (risk check) throws → a gift card and a plain ride are held, not booked', async () => {
    const boom: RiskChecker = { check: async () => { throw new Error('bedrock down'); } };
    const ctx = await newHousehold({ risk: boom });
    await speakAs(ctx.store, ctx.hh, 'maya');
    const r: any = await requestAction(ctx.deps, ctx.hh, ride);
    if (r.next === 'confirm_on_phone') {
      const c = (await getChallenge(ctx.deps, ctx.hh, r.job_id))!;
      await phoneConfirm(ctx.deps, ctx.hh, 'maya', { challenge_id: c.id, number: c.number });
      await (ctx.queue as any).drain();
      const job: any = await jobStatus(ctx.deps, ctx.hh, r.job_id);
      expect(job.status, JSON.stringify(job)).not.toBe('done');
    } else expect(doneAllowed(r)).toBe(false);
    expect(await countBookings(new Store(localClient()), ctx.hh)).toBe(0); // a fresh, healthy store counts rides
  });

  it('Bedrock times out (hangs) → still held, and fast enough to not hang the caller forever', async () => {
    const hang: RiskChecker = { check: () => new Promise(() => undefined) };
    const ctx = await newHousehold({ risk: hang });
    await speakAs(ctx.store, ctx.hh, 'maya');
    const t0 = Date.now();
    const r: any = await requestAction(ctx.deps, ctx.hh, ride); // the risk check is in the worker, not the reply path
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(doneAllowed(r)).toBe(false);
  });

  it('lights still work for a guest with Bedrock down (the model is not in the reply path)', async () => {
    const boom: RiskChecker = { check: async () => { throw new Error('bedrock down'); } };
    const ctx = await newHousehold({ risk: boom });
    const r: any = await requestAction(ctx.deps, ctx.hh, lights);
    expect(r.outcome).toBe('allowed');
  });
});
