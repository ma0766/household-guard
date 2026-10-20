import { randomInt, randomUUID } from 'node:crypto';
import type { Deps } from '../core/request-action.js';
import { Store } from '../core/store.js';
import type { ActionArgs } from '../core/types.js';
import { executeAction } from '../core/execute.js';
import { beginAttempt, clearWrong, failAttempt, recordPush, isLocked } from '../identity/guard.js';
import { setSession } from '../core/household.js';

// "Confirm on your phone: 47". Alexa SAYS the number; the person's own phone SHOWS three numbers; they tap the match.
// Number matching defeats blind "yes" taps — the push-fatigue attack.
export const CHALLENGE_MS = 10 * 60 * 1000;

export interface Challenge {
  id: string;
  kind: 'login' | 'action';
  personId: string;
  number: number;
  options: number[];
  status: 'open' | 'done' | 'failed' | 'expired';
  args?: ActionArgs;
  result?: { done: boolean; reason: string };
  expiresAt: number;
}

const two = () => randomInt(10, 100);

export function pickOptions(real: number): number[] {
  const set = new Set([real]);
  while (set.size < 3) set.add(two());
  return [...set].sort(() => randomInt(-1, 2)); // shuffled so position gives nothing away
}

const key = (id: string) => `CHAL#${id}`;

export async function openChallenge(deps: Deps, hh: string, p: { id: string; name: string }, kind: Challenge['kind'], args?: ActionArgs): Promise<{ challenge?: Challenge; locked: boolean }> {
  const now = (deps.now ?? Date.now)();
  if ((await recordPush(deps.store, hh, p.id, p.name, now)) === 'locked') return { locked: true };
  const number = two();
  const challenge: Challenge = { id: randomUUID().slice(0, 12), kind, personId: p.id, number, options: pickOptions(number), status: 'open', args, expiresAt: now + CHALLENGE_MS };
  await deps.store.put({ pk: Store.hk(hh), sk: key(challenge.id), ...challenge, ttl: Math.floor(now / 1000) + 3600 });
  return { challenge, locked: false };
}

export async function getChallenge(deps: Deps, hh: string, id: string): Promise<Challenge | undefined> {
  const r = await deps.store.get(Store.hk(hh), key(id));
  return r as unknown as Challenge | undefined;
}

export async function openChallengesFor(deps: Deps, hh: string, personId: string): Promise<Challenge[]> {
  const now = (deps.now ?? Date.now)();
  const all = (await deps.store.query(Store.hk(hh), 'CHAL#')) as unknown as Challenge[];
  return all.filter((c) => c.personId === personId && c.status === 'open' && c.expiresAt > now);
}

export type TapResult = { status: 'confirmed' | 'wrong' | 'locked' | 'expired' | 'not_yours' | 'unknown'; say: string; result?: Challenge['result'] };

// The person taps a number on THEIR OWN phone. Wrong person, wrong number, or too late → nothing happens.
export async function tapNumber(deps: Deps, hh: string, personId: string, name: string, challengeId: string, number: number): Promise<TapResult> {
  const now = (deps.now ?? Date.now)();
  const c = await getChallenge(deps, hh, challengeId);
  if (!c) return { status: 'unknown', say: "I can't find that." };
  if (c.personId !== personId) {
    if ((await beginAttempt(deps.store, hh, personId, now)) === 'ok') await failAttempt(deps.store, hh, personId, name, now); // probing someone else's number counts against the prober
    return { status: 'not_yours', say: 'That is not for you.' };
  }
  if (c.status !== 'open' || c.expiresAt <= now) return { status: 'expired', say: 'That one ran out of time.' };
  if (await isLocked(deps.store, hh, personId, now)) return { status: 'locked', say: 'Too many tries. Locked for 10 minutes.' };
  if ((await beginAttempt(deps.store, hh, personId, now)) === 'locked') return { status: 'locked', say: 'Too many tries. Locked for 10 minutes.' };
  if (number !== c.number) {
    const w = await failAttempt(deps.store, hh, personId, name, now);
    return w === 'locked' ? { status: 'locked', say: 'Too many tries. Locked for 10 minutes.' } : { status: 'wrong', say: 'Wrong number. Try again.' };
  }
  await clearWrong(deps.store, hh, personId, now);
  // close it first (conditional) so a double tap can never run the action twice
  try {
    await deps.store.update({ Key: { pk: Store.hk(hh), sk: key(c.id) }, UpdateExpression: 'SET #s = :done', ConditionExpression: '#s = :open', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':done': 'done', ':open': 'open' } });
  } catch {
    return { status: 'expired', say: 'That one is already done.' };
  }
  let result: Challenge['result'];
  if (c.kind === 'login') {
    await setSession(deps.store, hh, personId, 'phone', now);
    result = { done: true, reason: `${name} is confirmed.` };
  } else {
    try {
      result = await executeAction(deps, hh, personId, c.args!);
    } catch {
      result = { done: false, reason: 'Something went wrong. Ask an adult.' };
    }
  }
  await deps.store.update({ Key: { pk: Store.hk(hh), sk: key(c.id) }, UpdateExpression: 'SET #r = :r', ExpressionAttributeNames: { '#r': 'result' }, ExpressionAttributeValues: { ':r': result } });
  return { status: 'confirmed', say: result.reason, result };
}
