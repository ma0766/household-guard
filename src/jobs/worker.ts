import type { Deps } from '../core/request-action.js';
import { Store } from '../core/store.js';
import { commit, getReservation, pinReservation, release } from '../spend/spend.js';
import { MOCK_RIDE, bookRide, quoteRide, type RideOption } from '../connectors/mock-ride.js';
import { MOCK_SHOP, bookItem, quoteItem } from '../connectors/mock-shop.js';
import { approvalHash, createApproval, supersede } from '../approvals/approvals.js';
import { loadHousehold } from '../core/household.js';
import { T } from '../text.js';

export interface Job {
  id: string;
  personId: string;
  service: string;
  item?: string;
  optionId?: string;
  amountCents: number;
  reservationId: string;
  approvalId?: string; // set when an adult said yes to this exact purchase
  approvalHash?: string;
  replacesApprovalId?: string; // set when this is the cheaper option taken instead of a held one
  savedCents?: number;
  status: 'queued' | 'running' | 'done' | 'failed' | 'held';
  say?: string;
  newApprovalId?: string;
  runningAt?: number;
}

const jobKey = (id: string) => `JOB#${id}`;
export const LEASE_MS = 2 * 60 * 1000;

export async function createJob(deps: Deps, hh: string, j: Omit<Job, 'status'>): Promise<void> {
  await pinReservation(deps.store, hh, j.reservationId); // the sweep must not free money a job now owns
  await deps.store.put({ pk: Store.hk(hh), sk: jobKey(j.id), ...j, status: 'queued', ttl: Math.floor(Date.now() / 1000) + 7 * 86400 });
  try {
    await deps.queue!.send({ hh, jobId: j.id });
  } catch (e) {
    await finish(deps, hh, j.id, 'failed', T.bookFailed).catch(() => undefined);
    throw e; // caller releases the money
  }
}

async function finish(deps: Deps, hh: string, id: string, status: Job['status'], say: string, extra: Record<string, unknown> = {}) {
  const keys = Object.keys(extra);
  await deps.store.update({
    Key: { pk: Store.hk(hh), sk: jobKey(id) },
    UpdateExpression: 'SET #s = :s, say = :say' + keys.map((k) => `, ${k} = :x_${k}`).join(''),
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':s': status, ':say': say, ...Object.fromEntries(keys.map((k) => [`:x_${k}`, extra[k]])) },
  });
}

// Runs OFF the reply path (SQS worker Lambda in AWS). Before the ride is booked, every failure releases the money.
// After it is booked, money is NEVER released: the job is done, and the commit is retried.
export async function processJob(deps: Deps, hh: string, jobId: string): Promise<void> {
  const j = (await deps.store.get(Store.hk(hh), jobKey(jobId))) as unknown as Job | undefined;
  if (!j) return;
  const now = (deps.now ?? Date.now)();
  try {
    // claim it. A re-delivered message cannot run the job twice; a job stuck "running" past its lease can be taken over.
    await deps.store.update({
      Key: { pk: Store.hk(hh), sk: jobKey(jobId) },
      UpdateExpression: 'SET #s = :run, runningAt = :now',
      ConditionExpression: '#s = :q OR (#s = :run AND runningAt < :stale)',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':run': 'running', ':q': 'queued', ':now': now, ':stale': now - LEASE_MS },
    });
  } catch (e: any) {
    if (e?.name === 'ConditionalCheckFailedException') return; // someone else has it, or it is finished
    throw e; // a real error: let the queue deliver it again
  }
  let booked = false;
  let total = j.amountCents;
  try {
    const res = await getReservation(deps.store, hh, j.reservationId);
    if (!res || res.state !== 'reserved') throw new Error('money is no longer reserved'); // nothing booked, nothing to release
    let service: { destination?: string; itemKey: string; amount: number; optionId?: string; opt?: RideOption; note?: string } | undefined;
    if (j.service === MOCK_RIDE) {
      const q = await quoteRide(deps.store, hh, j.item);
      const opt = q?.options.find((o) => o.id === (j.optionId ?? 'standard'));
      if (q && opt) service = { destination: q.destination, itemKey: `${q.destination}/${opt.id}`, amount: opt.total_cents, optionId: opt.id, opt, note: q.note };
    } else if (j.service === MOCK_SHOP) {
      const q = quoteItem(j.item);
      if (q) service = { itemKey: q.item, amount: q.total_cents };
    }
    if (!service) throw new Error('no quote');

    // Re-quote. If what we would buy is not exactly what was approved, it goes BACK TO HOLD — the old yes does not apply (gap 5).
    const hashNow = approvalHash({ amount_cents: service.amount, merchant: j.service, item: service.itemKey, person: j.personId });
    const changed = service.amount !== j.amountCents || (j.approvalHash !== undefined && hashNow !== j.approvalHash);
    if (changed) {
      await release(deps.store, hh, j.reservationId);
      const { people } = await loadHousehold(deps.store, hh);
      const name = people.find((p) => p.id === j.personId)?.name ?? 'Someone';
      const a = await createApproval(deps, hh, { personId: j.personId, personName: name, service: j.service, itemText: j.item, itemKey: service.itemKey, optionId: service.optionId, amountCents: service.amount, reason: T.priceChanged });
      return await finish(deps, hh, jobId, 'held', `${T.priceChanged} An adult can tap ${a.number} to say yes.`, { newApprovalId: a.id });
    }

    // AI risk check — here in the worker, never in the reply path (gap 3). It may only turn "do it" into "hold":
    // the only thing read from it is verdict === 'hold'. An adult's yes on this exact purchase is stronger, so it is not asked again.
    if (!j.approvalId) {
      const { people } = await loadHousehold(deps.store, hh);
      const who = people.find((p) => p.id === j.personId);
      let verdict: 'ok' | 'hold' = 'hold'; // no answer = hold
      try {
        verdict = (await deps.risk!.check({ person: j.personId, role: who?.role ?? 'guest', service: j.service, item: j.item, amountCents: service.amount, serviceText: service.note })).verdict === 'ok' ? 'ok' : 'hold';
      } catch {
        verdict = 'hold';
      }
      if (verdict === 'hold') {
        await release(deps.store, hh, j.reservationId);
        const a = await createApproval(deps, hh, { personId: j.personId, personName: who?.name ?? 'Someone', service: j.service, itemText: j.item, itemKey: service.itemKey, optionId: service.optionId, amountCents: service.amount, reason: T.riskHeld });
        return await finish(deps, hh, jobId, 'held', `That needs a closer look. An adult can tap ${a.number} to say yes.`, { newApprovalId: a.id });
      }
    }

    // book exactly the quote that was hash-checked above — never a fresh second quote
    if (j.service === MOCK_RIDE) total = (await bookRide(deps.store, hh, service.destination!, service.opt!, j.id)).total_cents;
    else total = (await bookItem(deps.store, hh, service.itemKey, service.amount, j.id)).total_cents;
    booked = true;
  } catch {
    if (!booked) {
      await release(deps.store, hh, j.reservationId).catch(() => undefined);
      await finish(deps, hh, jobId, 'failed', T.bookFailed).catch(() => undefined);
      return;
    }
  }
  // booked: count it for good. Retry a few times; never release.
  for (let i = 0; i < 5; i++) {
    try {
      await commit(deps.store, hh, j.reservationId);
      break;
    } catch {
      /* retry */
    }
  }
  if (j.replacesApprovalId) await supersede(deps, hh, j.replacesApprovalId);
  await finish(deps, hh, jobId, 'done', j.service === MOCK_RIDE ? T.rideBooked(total) : T.bought(total)).catch(() => undefined);
  if (j.savedCents && j.savedCents > 0) await recordSaving(deps, hh, j).catch(() => undefined);
}

// "Saved $24": the difference between the held price and the cheaper option the person took.
async function recordSaving(deps: Deps, hh: string, j: Job): Promise<void> {
  const now = (deps.now ?? Date.now)();
  await deps.store.put({ pk: Store.hk(hh), sk: `SAVED#${String(now).padStart(15, '0')}#${j.id}`, jobId: j.id, personId: j.personId, savedCents: j.savedCents, at: now, ttl: Math.floor(now / 1000) + 90 * 86400 });
}
