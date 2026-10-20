import { Store } from '../core/store.js';

// Spend cap is enforced HERE, in the database, as the last guard.
// Rules said yes to two $15 buys at once? Both read "$0 spent". Only one conditional write can win.
export const RESERVATION_MS = 10 * 60 * 1000;

export interface Reservation {
  id: string;
  person: string;
  amount: number;
  week: string;
  state: 'reserved' | 'committed' | 'released';
  expiresAt: number;
}

const spendKey = (week: string, person: string) => `SPEND#${week}#${person}`;
const resKey = (id: string) => `RES#${id}`;

export async function spentThisWeek(store: Store, hh: string, week: string, person: string): Promise<number> {
  const r = await store.get(Store.hk(hh), spendKey(week, person));
  return Number(r?.spent ?? 0);
}

// DynamoDB conditions cannot add, so: ADD spent :amt  with condition  spent <= cap - amt.
// One TransactWriteItems = the counter bump and the reservation record succeed or fail together.
export async function reserve(store: Store, hh: string, r: Omit<Reservation, 'state'>, cap: number | null): Promise<'ok' | 'cap'> {
  const pk = Store.hk(hh);
  const bump: any = {
    Update: {
      TableName: store.table,
      Key: { pk, sk: spendKey(r.week, r.person) },
      UpdateExpression: 'ADD spent :amt SET #t = :ttl',
      ExpressionAttributeNames: { '#t': 'ttl' },
      ExpressionAttributeValues: { ':amt': r.amount, ':ttl': Math.floor(Date.now() / 1000) + 14 * 86400 },
    },
  };
  if (cap !== null) {
    bump.Update.ConditionExpression = 'attribute_not_exists(spent) OR spent <= :max';
    bump.Update.ExpressionAttributeValues[':max'] = cap - r.amount;
  }
  const put = { Put: { TableName: store.table, Item: { pk, sk: resKey(r.id), ...r, state: 'reserved', ttl: Math.floor(Date.now() / 1000) + 14 * 86400 }, ConditionExpression: 'attribute_not_exists(pk)' } };
  try {
    await store.transact([bump, put], r.id);
    return 'ok';
  } catch (e: any) {
    if (e?.name === 'TransactionCanceledException') {
      const reasons: { Code?: string }[] = e.CancellationReasons ?? [];
      if (reasons[0]?.Code === 'ConditionalCheckFailed') return 'cap';
      // reservation id already used (a retry of the same reservation): treat as ok only if it is ours and still reserved
      if (reasons[1]?.Code === 'ConditionalCheckFailed') {
        const existing = await store.get(pk, resKey(r.id));
        if (existing?.state === 'reserved') return 'ok';
      }
    }
    throw e; // anything else: caller fails closed (held)
  }
}

export async function getReservation(store: Store, hh: string, id: string): Promise<Reservation | undefined> {
  return (await store.get(Store.hk(hh), resKey(id))) as unknown as Reservation | undefined;
}

export async function commit(store: Store, hh: string, id: string): Promise<boolean> {
  try {
    await store.update({ Key: { pk: Store.hk(hh), sk: resKey(id) }, UpdateExpression: 'SET #s = :c', ConditionExpression: '#s = :r', ExpressionAttributeNames: { '#s': 'state' }, ExpressionAttributeValues: { ':c': 'committed', ':r': 'reserved' } });
    return true;
  } catch (e: any) {
    if (e?.name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}

// Give the money back: only if still reserved, and in one transaction with the counter.
export async function release(store: Store, hh: string, id: string): Promise<boolean> {
  const r = await getReservation(store, hh, id);
  if (!r || r.state !== 'reserved') return false;
  const pk = Store.hk(hh);
  try {
    await store.transact([
      { Update: { TableName: store.table, Key: { pk, sk: resKey(id) }, UpdateExpression: 'SET #s = :rel', ConditionExpression: '#s = :r', ExpressionAttributeNames: { '#s': 'state' }, ExpressionAttributeValues: { ':rel': 'released', ':r': 'reserved' } } },
      { Update: { TableName: store.table, Key: { pk, sk: spendKey(r.week, r.person) }, UpdateExpression: 'ADD spent :neg', ExpressionAttributeValues: { ':neg': -r.amount } } },
    ]);
    return true;
  } catch (e: any) {
    if (e?.name === 'TransactionCanceledException') return false;
    throw e;
  }
}

// A reservation nobody finished (never tapped, never approved) must not lock the cap forever.
export async function releaseExpired(store: Store, hh: string, now: number): Promise<number> {
  const all = (await store.query(Store.hk(hh), 'RES#')) as unknown as Reservation[];
  let n = 0;
  for (const r of all) if (r.state === 'reserved' && r.expiresAt <= now && (await release(store, hh, r.id))) n++;
  return n;
}
