import { Store } from '../core/store.js';

// Push-flood and PIN-guessing guard (why number matching + limits exist: attackers spam approvals until someone taps yes).
export const WINDOW_MS = 10 * 60 * 1000;
export const MAX_PUSHES = 3;
export const MAX_WRONG = 3;

interface GuardRow {
  pushes: number[];
  wrong: number;
  lockedUntil: number;
}

async function load(store: Store, hh: string, person: string): Promise<GuardRow> {
  const r = await store.get(Store.hk(hh), `GUARD#${person}`);
  return { pushes: r?.pushes ?? [], wrong: r?.wrong ?? 0, lockedUntil: r?.lockedUntil ?? 0 };
}
const save = (store: Store, hh: string, person: string, g: GuardRow, now: number) =>
  store.put({ pk: Store.hk(hh), sk: `GUARD#${person}`, ...g, ttl: Math.floor(now / 1000) + 3600 });

export async function isLocked(store: Store, hh: string, person: string, now: number): Promise<boolean> {
  return (await load(store, hh, person)).lockedUntil > now;
}

export async function notifyAdults(store: Store, hh: string, text: string, now: number): Promise<void> {
  await store.put({ pk: Store.hk(hh), sk: `NOTICE#${String(now).padStart(15, '0')}#${Math.random().toString(36).slice(2, 6)}`, text, at: now, ttl: Math.floor(now / 1000) + 86400 });
}

// 4th confirmation request inside 10 minutes → lock for 10 minutes and tell an adult.
export async function recordPush(store: Store, hh: string, person: string, name: string, now: number): Promise<'ok' | 'locked'> {
  const g = await load(store, hh, person);
  if (g.lockedUntil > now) return 'locked';
  g.pushes = g.pushes.filter((t) => now - t < WINDOW_MS);
  if (g.pushes.length >= MAX_PUSHES) {
    g.lockedUntil = now + WINDOW_MS;
    g.pushes = [];
    await save(store, hh, person, g, now);
    await notifyAdults(store, hh, `${name} asked too many times. Locked for 10 minutes.`, now);
    return 'locked';
  }
  g.pushes.push(now);
  await save(store, hh, person, g, now);
  return 'ok';
}

// 3 wrong answers (PIN or number) → same lock.
export async function recordWrong(store: Store, hh: string, person: string, name: string, now: number): Promise<'ok' | 'locked'> {
  const g = await load(store, hh, person);
  g.wrong += 1;
  if (g.wrong >= MAX_WRONG) {
    g.lockedUntil = now + WINDOW_MS;
    g.wrong = 0;
    await save(store, hh, person, g, now);
    await notifyAdults(store, hh, `${name} got it wrong 3 times. Locked for 10 minutes.`, now);
    return 'locked';
  }
  await save(store, hh, person, g, now);
  return 'ok';
}

export async function clearWrong(store: Store, hh: string, person: string, now: number): Promise<void> {
  const g = await load(store, hh, person);
  if (g.wrong) await save(store, hh, person, { ...g, wrong: 0 }, now);
}
