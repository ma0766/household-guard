import { describe, expect, it } from 'vitest';
import { newHousehold, speakAs } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';
import { phoneConfirm } from '../../src/identity/confirm.js';
import { getChallenge } from '../../src/approvals/challenge.js';
import { jobStatus } from '../../src/core/jobs.js';
import { spentThisWeek } from '../../src/spend/spend.js';
import { weekKey } from '../../src/core/time.js';
import { countBookings } from '../../src/connectors/mock-ride.js';

// The queue delivers at least once. The same job message arriving twice must still book one ride and take the money once.
describe('S3 queue redelivery (gap 6, back door)', () => {
  it('the same job message delivered three times books one ride and spends once', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya');
    const r = await requestAction(ctx.deps, ctx.hh, { service: 'mock-ride', action: 'purchase', item: 'ride to the mall' });
    const c = (await getChallenge(ctx.deps, ctx.hh, r.job_id as string))!;
    await phoneConfirm(ctx.deps, ctx.hh, 'maya', { challenge_id: c.id, number: c.number });
    // the real message is already queued; the queue now delivers it twice more
    await ctx.queue.send({ hh: ctx.hh, jobId: r.job_id as string });
    await ctx.queue.send({ hh: ctx.hh, jobId: r.job_id as string });
    await ctx.queue.drain();
    expect(await jobStatus(ctx.deps, ctx.hh, r.job_id as string)).toMatchObject({ status: 'done' });
    expect(await countBookings(ctx.store, ctx.hh)).toBe(1);
    expect(await spentThisWeek(ctx.store, ctx.hh, weekKey(Date.now(), 'America/New_York'), 'maya')).toBe(1500);
    // and a late fourth delivery, after it finished, changes nothing
    await ctx.queue.send({ hh: ctx.hh, jobId: r.job_id as string });
    await ctx.queue.drain();
    expect(await countBookings(ctx.store, ctx.hh)).toBe(1);
  });
});
