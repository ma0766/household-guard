import { Store } from '../core/store.js';

// One tap covers that person's buys for 5 minutes, as long as each buy stays inside their limits (the rules still decide every buy).
// Unlocking a door and changing a rule never use this: they always ask for a fresh tap.
export const TAP_WINDOW_MS = 5 * 60 * 1000;
const key = (person: string) => `TAPWIN#${person}`;

export async function openTapWindow(store: Store, hh: string, person: string, now: number): Promise<void> {
  await store.put({ pk: Store.hk(hh), sk: key(person), until: now + TAP_WINDOW_MS, ttl: Math.floor(now / 1000) + 3600 });
}

export async function tapCovers(store: Store, hh: string, person: string, now: number): Promise<boolean> {
  const r = await store.get(Store.hk(hh), key(person));
  return !!r && typeof r.until === 'number' && r.until > now;
}
