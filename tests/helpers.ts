import { randomUUID } from 'node:crypto';
import { Store } from '../src/core/store.js';
import { localClient } from '../src/core/local-dynamo.js';
import { ensureSeeded, setSession } from '../src/core/household.js';
import type { Deps } from '../src/core/request-action.js';

// Each test gets its own household id, so tests can run in parallel against one table without sharing spend.
export async function newHousehold(extra: Partial<Deps> = {}) {
  const hh = `t${randomUUID().slice(0, 8)}`;
  const store = new Store(localClient());
  await ensureSeeded(store, hh);
  const deps: Deps = { store, ...extra };
  return { hh, store, deps };
}

export type Who = 'mom' | 'maya' | 'leo' | 'guest';
export async function speakAs(store: Store, hh: string, who: Who, method: 'phone' | 'pin' = 'phone') {
  if (who === 'guest') return; // no confirmed session = guest
  await setSession(store, hh, who, method);
}
