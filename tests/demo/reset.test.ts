import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Store } from '../../src/core/store.js';
import { loadHousehold, resetDemoHousehold } from '../../src/core/household.js';
import { ensureLocalDynamo, localClient } from '../../src/core/local-dynamo.js';

describe('demo reset', () => {
  it('seeds Mom, Dad, Maya 15, Leo 8 and a guest, and wipes old rows', async () => {
    await ensureLocalDynamo();
    const store = new Store(localClient());
    const hh = `reset-${randomUUID().slice(0, 8)}`;
    await store.put({ pk: Store.hk(hh), sk: 'JUNK#1', x: 1 });
    const r = await resetDemoHousehold(store, hh);
    expect(r.removed).toBe(1);
    expect(await store.get(Store.hk(hh), 'JUNK#1')).toBeUndefined();
    const h = await loadHousehold(store, hh);
    expect(h.people.map((p) => p.id).sort()).toEqual(['dad', 'guest', 'leo', 'maya', 'mom']);
    expect(h.people.find((p) => p.id === 'maya')).toMatchObject({ role: 'teen', age: 15 });
    expect(h.people.find((p) => p.id === 'leo')).toMatchObject({ role: 'child', age: 8, hasPhone: false });
    expect(h.people.find((p) => p.id === 'leo')?.pinHash).toBeTruthy();
    expect(h.rules.weeklyCapCents.dad).toBe(50000);
    // running it twice gives the same house
    expect((await resetDemoHousehold(store, hh)).removed).toBeGreaterThan(0);
    await store.wipe(Store.hk(hh));
  });
});
