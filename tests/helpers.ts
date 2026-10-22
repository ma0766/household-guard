import { randomUUID } from 'node:crypto';
import { Store } from '../src/core/store.js';
import { localClient } from '../src/core/local-dynamo.js';
import { ensureSeeded, setSession } from '../src/core/household.js';
import type { Deps } from '../src/core/request-action.js';
import { makeDeps } from '../src/core/deps.js';
import { MockRisk } from '../src/risk/risk.js';
import type { LocalQueue } from '../src/queue/queue.js';

// Each test gets its own household id, so tests can run in parallel against one table without sharing spend.
export async function newHousehold(extra: Partial<Deps> = {}) {
  const hh = `t${randomUUID().slice(0, 8)}`;
  const store = new Store(localClient());
  await ensureSeeded(store, hh);
  const deps = makeDeps(store, { risk: new MockRisk(), ...extra });
  const queue = deps.queue as LocalQueue;
  return { hh, store, deps, queue };
}

export type Who = 'mom' | 'maya' | 'leo' | 'guest' | 'grandma';
export async function speakAs(store: Store, hh: string, who: Who, method: 'phone' | 'pin' = 'phone', now?: number) {
  if (who === 'guest') return; // no confirmed session = guest
  await setSession(store, hh, who, method, now);
}
