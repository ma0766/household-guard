import { createHash, randomUUID } from 'node:crypto';
import type { Deps } from '../core/request-action.js';
import { Store } from '../core/store.js';
import { loadHousehold } from '../core/household.js';
import { beginAttempt, clearWrong, failAttempt } from '../identity/guard.js';
import { pickOptions } from './challenge.js';
import { randomInt } from 'node:crypto';
import { release, reserve } from '../spend/spend.js';
import { weekKey } from '../core/time.js';
import { createJob } from '../jobs/worker.js';
import { T } from '../text.js';

// An approval is bound to ONE exact purchase: a hash of {amount, merchant, item, person}. It dies after 10 minutes.
// Approved $12 ride, price jumps to $38? Different hash → not approved any more (gap 5).
export const APPROVAL_MS = 10 * 60 * 1000;

export interface ApprovalFacts {
  amount_cents: number;
  merchant: string;
  item: string; // exact thing: "airport/standard"
  person: string;
}

export function approvalHash(f: ApprovalFacts): string {
  return createHash('sha256').update(JSON.stringify([f.amount_cents, f.merchant, f.item, f.person])).digest('hex');
}

export interface Approval {
  id: string;
  personId: string;
  personName: string;
  service: string;
  itemText?: string; // what the person said, for the quote
  itemKey: string;
  optionId?: string;
  amountCents: number;
  hash: string;
  reason: string;
  number: number; // Alexa says it; the adult's phone must tap it
  options: number[];
  status: 'open' | 'approved' | 'rejected' | 'expired' | 'superseded' | 'done';
  expiresAt: number;
  createdAt: number;
  jobId?: string;
}

const key = (id: string) => `APPROVAL#${id}`;

// One open approval per {person, item}: asking again must not leave two separately-approvable copies.
async function supersedeDuplicates(deps: Deps, hh: string, personId: string, service: string, itemKey: string): Promise<void> {
  for (const o of await openApprovals(deps, hh)) if (o.personId === personId && o.service === service && o.itemKey === itemKey) await supersede(deps, hh, o.id);
}

export async function createApproval(deps: Deps, hh: string, a: { personId: string; personName: string; service: string; itemText?: string; itemKey: string; optionId?: string; amountCents: number; reason: string }): Promise<Approval> {
  const now = (deps.now ?? Date.now)();
  await supersedeDuplicates(deps, hh, a.personId, a.service, a.itemKey);
  const number = randomInt(10, 100);
  const full: Approval = {
    id: randomUUID().slice(0, 12),
    ...a,
    hash: approvalHash({ amount_cents: a.amountCents, merchant: a.service, item: a.itemKey, person: a.personId }),
    number,
    options: pickOptions(number),
    status: 'open',
    expiresAt: now + APPROVAL_MS,
    createdAt: now,
  };
  await deps.store.put({ pk: Store.hk(hh), sk: key(full.id), ...full, ttl: Math.floor(now / 1000) + 86400 });
  return full;
}

export async function getApproval(deps: Deps, hh: string, id: string): Promise<Approval | undefined> {
  return (await deps.store.get(Store.hk(hh), key(id))) as unknown as Approval | undefined;
}

export async function openApprovals(deps: Deps, hh: string): Promise<Approval[]> {
  const now = (deps.now ?? Date.now)();
  const all = (await deps.store.query(Store.hk(hh), 'APPROVAL#')) as unknown as Approval[];
  return all.filter((a) => a.status === 'open' && a.expiresAt > now);
}

const setStatus = (deps: Deps, hh: string, id: string, from: string, to: string, extra: Record<string, unknown> = {}, notExpiredAt?: number) =>
  deps.store.update({
    Key: { pk: Store.hk(hh), sk: key(id) },
    UpdateExpression: 'SET #s = :to' + Object.keys(extra).map((k) => `, ${k} = :${k}`).join(''),
    // expiry is enforced IN the write, so a tap at minute 10:00 cannot sneak in after a read at 9:59
    ConditionExpression: '#s = :from' + (notExpiredAt !== undefined ? ' AND expiresAt > :now' : ''),
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':to': to, ':from': from, ...(notExpiredAt !== undefined ? { ':now': notExpiredAt } : {}), ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [`:${k}`, v])) },
  });

export async function supersede(deps: Deps, hh: string, id: string, strict = false): Promise<void> {
  const p = setStatus(deps, hh, id, 'open', 'superseded');
  if (strict) await p; // throws if it was no longer open
  else await p.catch(() => undefined);
}

export type ApproveStatus = 'approved' | 'rejected' | 'wrong' | 'locked' | 'expired' | 'unknown' | 'not_adult' | 'needs_phone';
export interface ApproveResult {
  status: ApproveStatus;
  say: string;
  job_id?: string;
}

// An adult says yes by tapping the number Alexa said, on their OWN phone. A spoken PIN can never approve money.
export async function approveRequest(deps: Deps, hh: string, approverId: string, approvalId: string, p: { number?: number; decision?: 'yes' | 'no'; method: 'phone' | 'pin'; voiceConfirmedAt?: number }): Promise<ApproveResult> {
  const now = (deps.now ?? Date.now)();
  try {
    const { people, meta } = await loadHousehold(deps.store, hh);
    const me = people.find((x) => x.id === approverId);
    if (!me || me.role !== 'adult') return { status: 'not_adult', say: T.onlyAdults };
    if (p.method !== 'phone') return { status: 'needs_phone', say: T.confirmPhone };
    const a = await getApproval(deps, hh, approvalId);
    if (!a) return { status: 'unknown', say: T.cantFind };
    if (a.status !== 'open' || a.expiresAt <= now) return { status: 'expired', say: 'That ran out of time.' };
    // By voice, the number is spoken out loud in the room, so it proves nothing alone. The adult must have confirmed
    // on their own phone AFTER this request was held, and within the last minute. An older session (a teen talking
    // after Mom's turn) cannot approve.
    if (p.voiceConfirmedAt !== undefined && (p.voiceConfirmedAt < a.createdAt || now - p.voiceConfirmedAt > 60_000) && p.decision !== 'no') return { status: 'needs_phone', say: T.confirmPhone };

    if (p.decision === 'no') {
      await setStatus(deps, hh, a.id, 'open', 'rejected').catch(() => undefined);
      return { status: 'rejected', say: 'Okay. I said no.' };
    }
    if ((await beginAttempt(deps.store, hh, me.id, now)) === 'locked') return { status: 'locked', say: T.locked };
    if (Number(p.number) !== a.number) {
      return (await failAttempt(deps.store, hh, me.id, me.name, now)) === 'locked' ? { status: 'locked', say: T.locked } : { status: 'wrong', say: 'Wrong number. Try again.' };
    }
    await clearWrong(deps.store, hh, me.id, now);
    // 1) reserve the money (an approved over-cap buy may pass the cap, but still counts toward the week)
    const week = weekKey(now, meta.timezone);
    const reservationId = randomUUID();
    await reserve(deps.store, hh, { id: reservationId, person: a.personId, amount: a.amountCents, week, expiresAt: now + 11 * 60 * 1000 }, null);
    // 2) flip open→approved, conditional and not expired: a double tap approves once, and the loser gives its money back
    try {
      await setStatus(deps, hh, a.id, 'open', 'approved', {}, now);
    } catch {
      await release(deps.store, hh, reservationId).catch(() => undefined);
      return { status: 'expired', say: 'That is already done.' };
    }
    // 3) hand to the worker. If that fails, undo both: money back, approval open again so an adult can retry.
    const jobId = randomUUID().slice(0, 12);
    try {
      await createJob(deps, hh, { id: jobId, personId: a.personId, service: a.service, item: a.itemText, optionId: a.optionId, amountCents: a.amountCents, reservationId, approvalId: a.id, approvalHash: a.hash });
      await deps.store.update({ Key: { pk: Store.hk(hh), sk: key(a.id) }, UpdateExpression: 'SET jobId = :j', ExpressionAttributeValues: { ':j': jobId } });
    } catch {
      await release(deps.store, hh, reservationId).catch(() => undefined);
      await setStatus(deps, hh, a.id, 'approved', 'open').catch(() => undefined);
      return { status: 'expired', say: T.oops };
    }
    return { status: 'approved', say: T.booking, job_id: jobId };
  } catch {
    return { status: 'expired', say: T.oops };
  }
}
