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

interface GuardItem extends GuardRow {
  v: number;
  lastWrong: number;
}

async function loadItem(store: Store, hh: string, person: string): Promise<GuardItem> {
  const r = await store.get(Store.hk(hh), `GUARD#${person}`);
  return { pushes: r?.pushes ?? [], wrong: r?.wrong ?? 0, lockedUntil: r?.lockedUntil ?? 0, v: r?.v ?? 0, lastWrong: r?.lastWrong ?? 0 };
}

// Optimistic concurrency: read, change, write only if nobody else wrote in between (else retry).
// Parallel guesses can no longer all read "0 wrong" — that would let a 4-digit PIN be brute-forced.
async function mutate<T>(store: Store, hh: string, person: string, now: number, fn: (g: GuardItem) => T): Promise<T> {
  for (let i = 0; i < 12; i++) {
    const g = await loadItem(store, hh, person);
    const out = fn(g);
    try {
      await store.put({ pk: Store.hk(hh), sk: `GUARD#${person}`, ...g, v: g.v + 1, ttl: Math.floor(now / 1000) + 3600 }, g.v === 0 ? { ifNotExists: true } : { ifVersion: g.v });
      return out;
    } catch (e: any) {
      if (e?.name !== 'ConditionalCheckFailedException') throw e;
    }
  }
  throw new Error('guard busy'); // fail closed: caller holds
}

export async function isLocked(store: Store, hh: string, person: string, now: number): Promise<boolean> {
  return (await loadItem(store, hh, person)).lockedUntil > now;
}

export async function notifyAdults(store: Store, hh: string, text: string, now: number): Promise<void> {
  await store.put({ pk: Store.hk(hh), sk: `NOTICE#${String(now).padStart(15, '0')}#${Math.random().toString(36).slice(2, 6)}`, text, at: now, ttl: Math.floor(now / 1000) + 86400 });
}

// 4th confirmation request inside 10 minutes → lock for 10 minutes and tell an adult.
export async function recordPush(store: Store, hh: string, person: string, name: string, now: number): Promise<'ok' | 'locked'> {
  const r = await mutate(store, hh, person, now, (g) => {
    if (g.lockedUntil > now) return 'locked' as const;
    g.pushes = g.pushes.filter((t) => now - t < WINDOW_MS);
    if (g.pushes.length >= MAX_PUSHES) {
      g.lockedUntil = now + WINDOW_MS;
      g.pushes = [];
      return 'newlock' as const;
    }
    g.pushes.push(now);
    return 'ok' as const;
  });
  if (r === 'newlock') {
    await notifyAdults(store, hh, `${name} asked too many times. Locked for 10 minutes.`, now);
    return 'locked';
  }
  return r;
}

// Guessing guard (PIN or number). The attempt is COUNTED BEFORE it is checked, so 50 parallel guesses
// cannot all slip in ahead of the lock: only the first 3 are ever evaluated.
export async function beginAttempt(store: Store, hh: string, person: string, now: number): Promise<'ok' | 'locked'> {
  return mutate(store, hh, person, now, (g) => {
    if (g.lockedUntil > now) return 'locked' as const;
    if (now - g.lastWrong > WINDOW_MS) g.wrong = 0;
    if (g.wrong >= MAX_WRONG) {
      g.lockedUntil = now + WINDOW_MS;
      g.wrong = 0;
      return 'locked' as const;
    }
    g.wrong += 1;
    g.lastWrong = now;
    return 'ok' as const;
  });
}

// The attempt was wrong. If it was the 3rd, lock now and tell an adult.
export async function failAttempt(store: Store, hh: string, person: string, name: string, now: number): Promise<'ok' | 'locked'> {
  const r = await mutate(store, hh, person, now, (g) => {
    if (g.wrong >= MAX_WRONG && g.lockedUntil <= now) {
      g.lockedUntil = now + WINDOW_MS;
      g.wrong = 0;
      return 'newlock' as const;
    }
    return g.lockedUntil > now ? ('locked' as const) : ('ok' as const);
  });
  if (r === 'newlock') {
    await notifyAdults(store, hh, `${name} got it wrong 3 times. Locked for 10 minutes.`, now);
    return 'locked';
  }
  return r === 'locked' ? 'locked' : 'ok';
}

export async function clearWrong(store: Store, hh: string, person: string, now: number): Promise<void> {
  await mutate(store, hh, person, now, (g) => {
    g.wrong = 0;
  });
}
