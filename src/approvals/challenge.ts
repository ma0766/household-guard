import { randomInt, randomUUID } from 'node:crypto';
import type { Deps } from '../core/request-action.js';
import { Store } from '../core/store.js';
import type { ActionArgs } from '../core/types.js';
import { T } from '../text.js';
import { executeAction } from '../core/execute.js';
import { beginAttempt, clearWrong, failAttempt, recordPush, isLocked } from '../identity/guard.js';
import { setSession } from '../core/household.js';
import { categoryOf, doneHome, emit } from '../audit/emit.js';
import { storeDeviceKey, removeDeviceKey } from '../devices/vault.js';
import { completeRule } from '../rules/change.js';
import { openTapWindow } from '../identity/tapwindow.js';

// "Confirm on your phone: 47". Alexa SAYS the number; the person's own phone SHOWS three numbers; they tap the match.
// Number matching defeats blind "yes" taps — the push-fatigue attack.
export const CHALLENGE_MS = 10 * 60 * 1000;

export interface Challenge {
  id: string;
  kind: 'login' | 'action' | 'rule';
  personId: string;
  number: number;
  options: number[];
  status: 'open' | 'done' | 'failed' | 'expired';
  args?: ActionArgs;
  meta?: Record<string, unknown>; // e.g. the money reservation this tap will release into a job
  result?: { done: boolean; reason: string; jobId?: string };
  expiresAt: number;
}

const two = () => randomInt(10, 100);

export function pickOptions(real: number): number[] {
  const set = new Set([real]);
  while (set.size < 3) set.add(two());
  return [...set].sort(() => randomInt(-1, 2)); // shuffled so position gives nothing away
}

const key = (id: string) => `CHAL#${id}`;

export async function openChallenge(deps: Deps, hh: string, p: { id: string; name: string }, kind: Challenge['kind'], args?: ActionArgs, meta?: Record<string, unknown>): Promise<{ challenge?: Challenge; locked: boolean }> {
  const now = (deps.now ?? Date.now)();
  if ((await recordPush(deps.store, hh, p.id, p.name, now)) === 'locked') return { locked: true };
  const number = two();
  const challenge: Challenge = { id: randomUUID().slice(0, 12), kind, personId: p.id, number, options: pickOptions(number), status: 'open', args, meta, expiresAt: now + CHALLENGE_MS };
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
export async function tapNumber(deps: Deps, hh: string, personId: string, name: string, challengeId: string, number: number, secret?: string): Promise<TapResult> {
  const now = (deps.now ?? Date.now)();
  const c = await getChallenge(deps, hh, challengeId);
  if (!c) return { status: 'unknown', say: "I can't find that." };
  if (c.personId !== personId) {
    if ((await beginAttempt(deps.store, hh, personId, now)) === 'ok') await failAttempt(deps.store, hh, personId, name, now); // probing someone else's number counts against the prober
    return { status: 'not_yours', say: 'That is not for you.' };
  }
  if (c.status !== 'open' || c.expiresAt <= now) return { status: 'expired', say: 'That one ran out of time.' };
  if (c.kind === 'rule' && c.meta?.needsKey && !(typeof secret === 'string' && secret.length >= 4 && secret.length <= 120)) return { status: 'wrong', say: T.keyFirst }; // no number is counted until the key is typed
  if (await isLocked(deps.store, hh, personId, now)) return { status: 'locked', say: 'Too many tries. Wait 10 minutes.' };
  if ((await beginAttempt(deps.store, hh, personId, now)) === 'locked') return { status: 'locked', say: 'Too many tries. Wait 10 minutes.' };
  if (number !== c.number) {
    const w = await failAttempt(deps.store, hh, personId, name, now);
    return w === 'locked' ? { status: 'locked', say: 'Too many tries. Wait 10 minutes.' } : { status: 'wrong', say: 'Wrong number. Try again.' };
  }
  await clearWrong(deps.store, hh, personId, now);
  // close it first (conditional) so a double tap can never run the action twice
  try {
    await deps.store.update({ Key: { pk: Store.hk(hh), sk: key(c.id) }, UpdateExpression: 'SET #s = :done', ConditionExpression: '#s = :open', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':done': 'done', ':open': 'open' } });
  } catch {
    return { status: 'expired', say: 'That one is already done.' };
  }
  let result: Challenge['result'];
  let privateLine: string | undefined; // said only on the phone that tapped (a new guest's PIN): never stored, never in the log
  if (c.kind === 'login') {
    await setSession(deps.store, hh, personId, 'phone', now);
    result = { done: true, reason: `Hi ${name}. You are confirmed.` };
    await emit(deps, hh, { kind: 'who', category: 'who', person: personId, personName: name, text: (t) => `${name} confirmed on their phone at ${t}.` });
  } else if (c.kind === 'rule') {
    try {
      const svc = (c.meta?.change as { service?: string } | undefined)?.service;
      if (c.meta?.needsKey && svc) await storeDeviceKey(deps.store, hh, svc, secret!, personId); // encrypted; the key is in no log, no answer, no record but this one
      const { private: priv, ...r } = await completeRule(deps, hh, personId, c);
      if (c.meta?.needsKey && svc && !r.done) await removeDeviceKey(deps.store, hh, svc);
      result = r;
      privateLine = priv;
    } catch {
      result = { done: false, reason: 'Something went wrong. Ask an adult.' };
    }
  } else {
    try {
      result = await executeAction(deps, hh, personId, c.args!, c.meta);
      if (c.meta?.purchase && result.jobId) {
        // this person just proved, on their own phone, that they are here: their next buys inside their limits need no new tap for 5 minutes.
        // (The session is NOT renewed: a late tap must never move "who is speaking" back to this person.) Best effort: the ride is already queued.
        await openTapWindow(deps.store, hh, personId, now).catch(() => undefined);
      }
      if (result.done) await emit(deps, hh, { kind: 'done', category: categoryOf(c.args!.action), person: personId, personName: name, text: (t) => doneHome(name, c.args!, t), data: { action: c.args!.action } });
    } catch {
      result = { done: false, reason: 'Something went wrong. Ask an adult.' };
    }
  }
  await deps.store.update({ Key: { pk: Store.hk(hh), sk: key(c.id) }, UpdateExpression: 'SET #r = :r', ExpressionAttributeNames: { '#r': 'result' }, ExpressionAttributeValues: { ':r': result } });
  return { status: 'confirmed', say: privateLine ? `${result.reason} ${privateLine}` : result.reason, result };
}
