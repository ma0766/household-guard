import { randomUUID } from 'node:crypto';
import { Store } from '../core/store.js';

// Mock shop: one place to buy things that are risky in a way the rules alone cannot see (gift cards).
export const MOCK_SHOP = 'mock-shop';
const CATALOG: Record<string, number> = { 'gift card': 1500, headphones: 1200, book: 900, voucher: 1500, 'vacuum bag': 1200, crypto: 10000, 'wire transfer': 20000, 'send money': 5000 };
const MAX_CENTS = 100_000; // $1,000: nothing in this demo shop costs more

// "a $200 gift card", "wire transfer of $500", "send $50 to Dana": the amount and the payee are read from the words, then checked.
// The words never decide a rule: the price and the kind of thing come back, and the rules (and the scam guard) judge them.
export function quoteItem(item: string | undefined): { item: string; total_cents: number; payee?: string } | undefined {
  const t = (item ?? '').toLowerCase().replace(/[-_]/g, ' ').replace(/\bbags?\b/, 'vacuum bag').replace(/vacuum vacuum/, 'vacuum');
  const key = Object.keys(CATALOG).find((k) => t.includes(k)) ?? (/\b(bitcoin|ethereum|btc)\b/.test(t) ? 'crypto' : /\bwire\b/.test(t) ? 'wire transfer' : /\b(send|pay)\b.*\bto\b/.test(t) ? 'send money' : undefined);
  if (!key) return undefined;
  const m = t.match(/\$\s*(\d{1,4})(?:\.(\d{2}))?/);
  const dollars = m ? Number(m[1]) * 100 + (m[2] ? Number(m[2]) : 0) : undefined;
  const amount = (['gift card', 'crypto', 'wire transfer', 'send money'].includes(key) && dollars !== undefined ? dollars : CATALOG[key]) ?? CATALOG[key];
  if (amount < 100 || amount > MAX_CENTS) return undefined;
  const payee = key === 'send money' ? t.match(/\bto ([a-z]{2,20})\b/)?.[1] : undefined;
  if (key === 'send money' && !payee) return undefined;
  return { item: payee ? `${key} to ${payee}` : key, total_cents: amount, ...(payee ? { payee } : {}) };
}

export const payeeKey = (payee: string) => `PAYEE#${payee.toLowerCase().replace(/[^a-z]/g, '').slice(0, 20)}`;
export async function knownPayee(store: Store, hh: string, payee: string): Promise<boolean> {
  return !!(await store.get(Store.hk(hh), payeeKey(payee)));
}
export async function rememberPayee(store: Store, hh: string, payee: string): Promise<void> {
  await store.put({ pk: Store.hk(hh), sk: payeeKey(payee), payee, at: Date.now() });
}

export async function bookItem(store: Store, hh: string, item: string, total: number, bookingId: string = randomUUID().slice(0, 8)) {
  const booking_id = bookingId;
  await store.put({ pk: Store.hk(hh), sk: `BOOKING#${booking_id}`, booking_id, item, total_cents: total, at: Date.now() }, { ifNotExists: true }).catch((e: any) => {
    if (e?.name !== 'ConditionalCheckFailedException') throw e;
  });
  return { booking_id, total_cents: total };
}
