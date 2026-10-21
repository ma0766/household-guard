import { describe, expect, it } from 'vitest';
import { newHousehold, speakAs } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';
import { jobStatus } from '../../src/core/jobs.js';
import { Store } from '../../src/core/store.js';

// Found by the audit on the deployed stack: a person who asks "how is it going?" in the moment between an adult's yes being saved and the
// job being made was told "Okay. That one is closed." (and a sign-in that had just been tapped was told a bare "Done.").
describe('asking for status in the gap between "saved" and "job made" is not a failure', () => {
  it('an approval that is approved but has no job yet is "working on it"', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya');
    const r: any = await requestAction(ctx.deps, ctx.hh, { service: 'mock-ride', action: 'purchase', item: 'ride to the airport' });
    expect(r.approval_id).toBeTruthy();
    const row = (await ctx.store.query(Store.hk(ctx.hh), 'APPROVAL#')).find((x) => x.id === r.approval_id)!;
    await ctx.store.update({ Key: { pk: Store.hk(ctx.hh), sk: row.sk }, UpdateExpression: 'SET #s = :a', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':a': 'approved' } });
    expect(await jobStatus(ctx.deps, ctx.hh, r.approval_id)).toMatchObject({ status: 'waiting', say: 'Working on it.', done: false });
  });

  it('a sign-in that is tapped but whose answer is not written yet is "working on it", not a bare "Done."', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya');
    const r: any = await requestAction(ctx.deps, ctx.hh, { service: 'mock-ride', action: 'purchase', item: 'ride to the mall' });
    expect(r.job_id).toBeTruthy();
    const key = { pk: Store.hk(ctx.hh), sk: (await ctx.store.query(Store.hk(ctx.hh), 'CHAL#'))[0].sk };
    await ctx.store.update({ Key: key, UpdateExpression: 'SET #s = :d', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':d': 'done' } });
    expect(await jobStatus(ctx.deps, ctx.hh, r.job_id)).toMatchObject({ status: 'waiting', say: 'Working on it.', done: false });
  });
});
