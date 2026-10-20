import { randomUUID } from 'node:crypto';
import { Store } from '../core/store.js';

// Mock shop: one place to buy things that are risky in a way the rules alone cannot see (gift cards).
export const MOCK_SHOP = 'mock-shop';
const CATALOG: Record<string, number> = { 'gift card': 1500, headphones: 1200, book: 900 };

export function quoteItem(item: string | undefined): { item: string; total_cents: number } | undefined {
  const t = (item ?? '').toLowerCase();
  const key = Object.keys(CATALOG).find((k) => t.includes(k));
  return key ? { item: key, total_cents: CATALOG[key] } : undefined;
}

export async function bookItem(store: Store, hh: string, item: string, total: number, bookingId: string = randomUUID().slice(0, 8)) {
  const booking_id = bookingId;
  await store.put({ pk: Store.hk(hh), sk: `BOOKING#${booking_id}`, booking_id, item, total_cents: total, at: Date.now() }, { ifNotExists: true }).catch((e: any) => {
    if (e?.name !== 'ConditionalCheckFailedException') throw e;
  });
  return { booking_id, total_cents: total };
}
