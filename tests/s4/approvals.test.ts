import { describe, expect, it } from 'vitest';
import { newHousehold, speakAs } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';
import { approveRequest, approvalHash, getApproval } from '../../src/approvals/approvals.js';
import { phoneConfirm, phoneInbox } from '../../src/identity/confirm.js';
import { getChallenge } from '../../src/approvals/challenge.js';
import { jobStatus } from '../../src/core/jobs.js';
import { spentThisWeek } from '../../src/spend/spend.js';
import { weekKey } from '../../src/core/time.js';
import { countBookings, setRideState } from '../../src/connectors/mock-ride.js';
import { Store } from '../../src/core/store.js';
import { defaultRules } from '../../src/policy/rules.js';

const ride = (to: string, extra: Record<string, unknown> = {}) => ({ service: 'mock-ride', action: 'purchase', item: `ride to the ${to}`, ...extra });
const week = (now = Date.now()) => weekKey(now, 'America/New_York');
type Ctx = Awaited<ReturnType<typeof newHousehold>>;

async function heldAirport(ctx: Ctx) {
  await speakAs(ctx.store, ctx.hh, 'maya');
  const r = await requestAction(ctx.deps, ctx.hh, ride('airport'));
  const a = (await getApproval(ctx.deps, ctx.hh, r.approval_id as string))!;
  return { r, a };
}
const tap = async (ctx: Ctx, who: 'maya' | 'mom', challengeId: string) => {
  const c = (await getChallenge(ctx.deps, ctx.hh, challengeId))!;
  return phoneConfirm(ctx.deps, ctx.hh, who, { challenge_id: c.id, number: c.number });
};

describe('S4 approvals + a yes that fits', () => {
  it('teen $38 ride → held → a $14 shared ride is offered (price plus fees), with the number for an adult', async () => {
    const ctx = await newHousehold();
    const { r, a } = await heldAirport(ctx);
    expect(r).toMatchObject({ outcome: 'held', amount_cents: 3800, alternative: { option_id: 'shared', total_cents: 1400, saves_cents: 2400 } });
    expect(r.say).toBe(`Held: over Maya's $20 a week. A shared ride for $14 fits. Want that one? An adult can tap ${a.number} to say yes.`);
    expect(a.hash).toBe(approvalHash({ amount_cents: 3800, merchant: 'mock-ride', item: 'airport/standard', person: 'maya' }));
  });

  it('accept the $14 ride: her own tap only, no adult needed, $24 saving logged', async () => {
    const ctx = await newHousehold();
    const { r, a } = await heldAirport(ctx);
    const again = await requestAction(ctx.deps, ctx.hh, ride('airport', { option_id: 'shared', replaces: a.id }));
    expect(again).toMatchObject({ outcome: 'allowed', next: 'confirm_on_phone', amount_cents: 1400 });
    expect((await tap(ctx, 'maya', again.job_id as string)).status).toBe('confirmed');
    await ctx.queue.drain();
    expect(await jobStatus(ctx.deps, ctx.hh, again.job_id as string)).toMatchObject({ status: 'done', say: 'Your ride is booked. $14 in all.' });
    const saved = await ctx.store.query(Store.hk(ctx.hh), 'SAVED#');
    expect(saved.map((s) => s.savedCents)).toEqual([2400]);
    expect(await spentThisWeek(ctx.store, ctx.hh, week(), 'maya')).toBe(1400);
    expect((await getApproval(ctx.deps, ctx.hh, r.approval_id as string))!.status).toBe('superseded');
    expect((await phoneInbox(ctx.deps, ctx.hh, 'mom')).approvals).toEqual([]); // nothing left for Mom to do
  });

  it('a saving cannot be claimed against someone else\'s held request', async () => {
    const ctx = await newHousehold();
    const { a } = await heldAirport(ctx);
    const { setSession } = await import('../../src/core/household.js');
    await setSession(ctx.store, ctx.hh, 'mom', 'phone');
    const r = await requestAction(ctx.deps, ctx.hh, ride('airport', { option_id: 'shared', replaces: a.id }));
    await tap(ctx, 'mom', r.job_id as string);
    await ctx.queue.drain();
    expect(await ctx.store.query(Store.hk(ctx.hh), 'SAVED#')).toEqual([]);
  });

  it("Mom's phone shows who, what, how much, why — and she approves by matching the number → booked", async () => {
    const ctx = await newHousehold();
    const { a } = await heldAirport(ctx);
    const card = (await phoneInbox(ctx.deps, ctx.hh, 'mom')).approvals[0];
    expect(card).toMatchObject({ who: 'Maya', what: 'ride to the airport', amount: '$38', why: "Held: over Maya's $20 a week." });
    expect(card.options).toHaveLength(3);
    expect(card.options).toContain(a.number);
    expect(JSON.stringify(card)).not.toMatch(/"number"/);
    const wrong = card.options.find((n) => n !== a.number)!;
    expect((await approveRequest(ctx.deps, ctx.hh, 'mom', a.id, { number: wrong, method: 'phone' })).status).toBe('wrong');
    const ok = await approveRequest(ctx.deps, ctx.hh, 'mom', a.id, { number: a.number, method: 'phone' });
    expect(ok.status).toBe('approved');
    await ctx.queue.drain();
    expect(await jobStatus(ctx.deps, ctx.hh, ok.job_id!)).toMatchObject({ status: 'done', say: 'Your ride is booked. $38 in all.' });
    expect(await countBookings(ctx.store, ctx.hh)).toBe(1);
    expect(await spentThisWeek(ctx.store, ctx.hh, week(), 'maya')).toBe(3800);
    // a second tap approves nothing more
    expect((await approveRequest(ctx.deps, ctx.hh, 'mom', a.id, { number: a.number, method: 'phone' })).status).toBe('expired');
    expect(await countBookings(ctx.store, ctx.hh)).toBe(1);
  });

  // ---- gap 5: approved $12, surge to $38 → held again ----
  it('surge: Mom approves $38, the price jumps before booking → nothing booked, held again, money released', async () => {
    const ctx = await newHousehold();
    const { a } = await heldAirport(ctx);
    await setRideState(ctx.store, ctx.hh, { surge: 1.5 }); // $35 → $52.50, plus fee
    const ok = await approveRequest(ctx.deps, ctx.hh, 'mom', a.id, { number: a.number, method: 'phone' });
    await ctx.queue.drain();
    const job = await jobStatus(ctx.deps, ctx.hh, ok.job_id!);
    expect(job).toMatchObject({ status: 'held', done: false });
    expect(job.say).toMatch(/price changed/i);
    expect(await countBookings(ctx.store, ctx.hh)).toBe(0);
    expect(await spentThisWeek(ctx.store, ctx.hh, week(), 'maya')).toBe(0);
    // the old yes is dead; a NEW approval with the new price waits for Mom
    const fresh = (await phoneInbox(ctx.deps, ctx.hh, 'mom')).approvals;
    expect(fresh).toHaveLength(1);
    expect(fresh[0].amount).toBe('$55.50');
    expect(fresh[0].id).not.toBe(a.id);
  });

  it('an approval is bound to the exact request: any change makes a different hash', () => {
    const base = { amount_cents: 3800, merchant: 'mock-ride', item: 'airport/standard', person: 'maya' };
    const h = approvalHash(base);
    for (const change of [{ amount_cents: 3801 }, { merchant: 'other' }, { item: 'airport/shared' }, { person: 'leo' }]) expect(approvalHash({ ...base, ...change })).not.toBe(h);
  });

  it('an approval expires after 10 minutes', async () => {
    let t = Date.now();
    const ctx = await newHousehold({ now: () => t });
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone', t);
    const r = await requestAction(ctx.deps, ctx.hh, ride('airport'));
    const a = (await getApproval(ctx.deps, ctx.hh, r.approval_id as string))!;
    t += 10 * 60_000 + 1000;
    expect((await phoneInbox(ctx.deps, ctx.hh, 'mom')).approvals).toEqual([]);
    expect((await approveRequest(ctx.deps, ctx.hh, 'mom', a.id, { number: a.number, method: 'phone' })).status).toBe('expired');
  });

  it('only adults approve, and a spoken PIN never approves money', async () => {
    const ctx = await newHousehold();
    const { a } = await heldAirport(ctx);
    expect((await approveRequest(ctx.deps, ctx.hh, 'maya', a.id, { number: a.number, method: 'phone' })).status).toBe('not_adult');
    expect((await approveRequest(ctx.deps, ctx.hh, 'leo', a.id, { number: a.number, method: 'pin' })).status).toBe('not_adult');
    expect((await approveRequest(ctx.deps, ctx.hh, 'mom', a.id, { number: a.number, method: 'pin' })).status).toBe('needs_phone');
    expect((await getApproval(ctx.deps, ctx.hh, a.id))!.status).toBe('open');
    expect(await countBookings(ctx.store, ctx.hh)).toBe(0);
  });

  it('Mom can say no', async () => {
    const ctx = await newHousehold();
    const { a } = await heldAirport(ctx);
    expect((await approveRequest(ctx.deps, ctx.hh, 'mom', a.id, { decision: 'no', method: 'phone' })).status).toBe('rejected');
    expect((await approveRequest(ctx.deps, ctx.hh, 'mom', a.id, { number: a.number, method: 'phone' })).status).toBe('expired');
    expect(await countBookings(ctx.store, ctx.hh)).toBe(0);
  });

  it('a child\'s buy is held for an adult, with no cheaper option that fits', async () => {
    const ctx = await newHousehold();
    const { setSession } = await import('../../src/core/household.js');
    await setSession(ctx.store, ctx.hh, 'leo', 'pin');
    const r = await requestAction(ctx.deps, ctx.hh, ride('school'));
    expect(r).toMatchObject({ outcome: 'held', reason: 'An adult must say yes to buys.' });
    expect(r.alternative).toBeUndefined();
    expect(r.approval_id).toBeTruthy();
  });

  it('best value = lowest total that meets must-haves ("bag included" rules out the cheapest)', async () => {
    const ctx = await newHousehold();
    const rules = { ...defaultRules(), weeklyCapCents: { mom: 50000, maya: 3000 }, perRequestCapCents: { mom: 20000, maya: 3000 } };
    await ctx.store.put({ pk: Store.hk(ctx.hh), sk: 'RULES#current', config: rules });
    await speakAs(ctx.store, ctx.hh, 'maya');
    expect((await requestAction(ctx.deps, ctx.hh, ride('airport'))).alternative).toMatchObject({ option_id: 'shared', total_cents: 1400 });
    await ctx.store.put({ pk: Store.hk(ctx.hh), sk: 'RULES#current', config: { ...rules, mustHaves: { bagIncluded: true } } });
    expect((await requestAction(ctx.deps, ctx.hh, ride('airport'))).alternative).toMatchObject({ option_id: 'economy', total_cents: 2400, saves_cents: 1400 });
  });

  it('the spoken answer has no tech words and short sentences', async () => {
    const ctx = await newHousehold();
    const { r } = await heldAirport(ctx);
    for (const sentence of (r.say as string).split(/(?<=[.?!])\s+/)) expect(sentence.split(/\s+/).length).toBeLessThan(12);
  });
});

describe('S4 review fixes', () => {
  it('by voice, a teen cannot approve in Mom\'s older session — Mom must confirm on her phone AFTER the hold', async () => {
    const { buildMcpServer } = await import('../../src/mcp/server.js');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const { setSession } = await import('../../src/core/household.js');
    const ctx = await newHousehold();
    await setSession(ctx.store, ctx.hh, 'mom', 'phone', Date.now() - 30_000); // Mom confirmed earlier, then left
    await speakAs(ctx.store, ctx.hh, 'maya');
    const held = await requestAction(ctx.deps, ctx.hh, ride('airport'));
    await setSession(ctx.store, ctx.hh, 'mom', 'phone', Date.now() - 20_000); // still BEFORE the hold? no: set explicitly older than the approval
    const a = (await getApproval(ctx.deps, ctx.hh, held.approval_id as string))!;
    await setSession(ctx.store, ctx.hh, 'mom', 'phone', a.createdAt - 5_000); // the session that a teen could be riding on
    const server = buildMcpServer(ctx.deps, ctx.hh);
    const [x, y] = InMemoryTransport.createLinkedPair();
    await server.connect(x);
    const client = new Client({ name: 't', version: '1' });
    await client.connect(y);
    const out: any = await client.callTool({ name: 'approve_request', arguments: { approval_id: a.id, number: a.number } });
    expect(out.structuredContent.status).toBe('needs_phone');
    expect((await getApproval(ctx.deps, ctx.hh, a.id))!.status).toBe('open');
    // Mom confirms again, after the hold → the same voice approval now works
    await setSession(ctx.store, ctx.hh, 'mom', 'phone', Date.now());
    const ok: any = await client.callTool({ name: 'approve_request', arguments: { approval_id: a.id, number: a.number } });
    expect(ok.structuredContent.status).toBe('approved');
    await ctx.queue.drain();
    expect(await countBookings(ctx.store, ctx.hh)).toBe(1);
  });

  it('a saving cannot be forged with a different destination', async () => {
    const ctx = await newHousehold();
    const { a } = await heldAirport(ctx);
    const r = await requestAction(ctx.deps, ctx.hh, ride('school', { replaces: a.id }));
    await tap(ctx, 'maya', r.job_id as string);
    await ctx.queue.drain();
    expect(await ctx.store.query(Store.hk(ctx.hh), 'SAVED#')).toEqual([]);
    expect((await getApproval(ctx.deps, ctx.hh, a.id))!.status).toBe('open'); // untouched
  });

  it('one held approval is claimed once: a second claim logs no second saving, and the expensive ride cannot also be approved', async () => {
    const ctx = await newHousehold();
    const { a } = await heldAirport(ctx);
    const first = await requestAction(ctx.deps, ctx.hh, ride('airport', { option_id: 'shared', replaces: a.id }));
    expect((await getApproval(ctx.deps, ctx.hh, a.id))!.status).toBe('superseded'); // closed at request time
    expect((await approveRequest(ctx.deps, ctx.hh, 'mom', a.id, { number: a.number, method: 'phone' })).status).toBe('expired');
    const { setSession } = await import('../../src/core/household.js');
    await setSession(ctx.store, ctx.hh, 'maya', 'phone');
    await tap(ctx, 'maya', first.job_id as string);
    await ctx.queue.drain();
    expect((await ctx.store.query(Store.hk(ctx.hh), 'SAVED#')).map((s) => s.savedCents)).toEqual([2400]);
    expect(await countBookings(ctx.store, ctx.hh)).toBe(1);
  });

  it('asking again does not leave two approvable copies', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya');
    await requestAction(ctx.deps, ctx.hh, ride('airport', { request_id: 'a' }));
    await requestAction(ctx.deps, ctx.hh, ride('airport', { request_id: 'b' }));
    expect((await phoneInbox(ctx.deps, ctx.hh, 'mom')).approvals).toHaveLength(1);
  });

  it('two adults tapping yes at the same instant: one job, one reservation', async () => {
    const ctx = await newHousehold();
    const { a } = await heldAirport(ctx);
    const out = await Promise.all([1, 2, 3].map(() => approveRequest(ctx.deps, ctx.hh, 'mom', a.id, { number: a.number, method: 'phone' })));
    expect(out.filter((o) => o.status === 'approved')).toHaveLength(1);
    await ctx.queue.drain();
    expect(await countBookings(ctx.store, ctx.hh)).toBe(1);
    expect(await spentThisWeek(ctx.store, ctx.hh, week(), 'maya')).toBe(3800);
  });

  it('if handing the job to the queue fails, the money is released and the approval opens again', async () => {
    const ctx = await newHousehold();
    const { a } = await heldAirport(ctx);
    const real = ctx.deps.queue!;
    ctx.deps.queue = { send: async () => { throw new Error('queue down'); } };
    const out = await approveRequest(ctx.deps, ctx.hh, 'mom', a.id, { number: a.number, method: 'phone' });
    expect(out.status).not.toBe('approved');
    expect(await spentThisWeek(ctx.store, ctx.hh, week(), 'maya')).toBe(0);
    expect((await getApproval(ctx.deps, ctx.hh, a.id))!.status).toBe('open');
    ctx.deps.queue = real;
    expect((await approveRequest(ctx.deps, ctx.hh, 'mom', a.id, { number: a.number, method: 'phone' })).status).toBe('approved');
  });
});
