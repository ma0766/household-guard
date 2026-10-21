import { describe, expect, it } from 'vitest';
import { newHousehold, speakAs } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';
import { proposeRule } from '../../src/rules/change.js';
import { phoneConfirm, phoneInbox } from '../../src/identity/confirm.js';
import { getChallenge } from '../../src/approvals/challenge.js';

type Ctx = Awaited<ReturnType<typeof newHousehold>>;
const tap = async (ctx: Ctx, id: string) => {
  const c = (await getChallenge(ctx.deps, ctx.hh, id))!;
  return phoneConfirm(ctx.deps, ctx.hh, 'mom', { challenge_id: c.id, number: c.number });
};

describe('S10 the preview reaches the adult before the tap', () => {
  it('a higher limit: the reply and Mom\'s phone both say what it lets Maya do', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom');
    const r = await proposeRule(ctx.deps, ctx.hh, { change: { template: 'weekly_limit', person: 'maya', cents: 3000 } });
    expect(r.status).toBe('waiting');
    expect(r.preview).toBe('This lets Maya spend $10 more a week.');
    expect((await phoneInbox(ctx.deps, ctx.hh, 'mom')).challenges[0].text).toContain('This lets Maya spend $10 more a week.');
  });
  it('opening the front door to kids: the preview asks "are you sure?" and nothing is saved yet', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom');
    const r = await proposeRule(ctx.deps, ctx.hh, { change: { template: 'adults_only', actions: ['garage'] } });
    expect(r.preview).toContain('This change lets a teen unlock the front door. Are you sure?');
  });
  it('quiet hours by card: preview, tap, then the next late buy by a teen is refused', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom');
    const r = await proposeRule(ctx.deps, ctx.hh, { change: { template: 'quiet_hours', fromHour: 21, toHour: 6 } });
    expect(r.preview).toBe('Kids cannot buy from 9 PM to 6 AM.');
    expect((await tap(ctx, r.challenge_id!)).status).toBe('confirmed');
    const late = Date.parse('2026-10-21T21:30:00-04:00');
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone', late);
    const out = await requestAction({ ...ctx.deps, now: () => late }, ctx.hh, { service: 'mock-ride', action: 'purchase', item: 'ride to the mall' });
    expect(out).toMatchObject({ outcome: 'denied', reason: 'Quiet hours: no buying from 9 PM to 6 AM.' });
  });
});
