import { createHash } from 'node:crypto';
import type { Deps } from '../core/request-action.js';
import { Store } from '../core/store.js';
import { localDate } from '../core/time.js';

// Append-only, hash-chained log. Every entry carries the hash of the one before it, so editing or removing a row shows.
// Each entry is stored ONCE as data and shown as a plain sentence (`text`).
export type Category = 'cart' | 'lock' | 'light' | 'rule' | 'who' | 'home';
export interface AuditInput {
  kind: string; // ask | done | approval | saving | who | rule | lock …
  category: Category;
  person: string; // who the entry is about ('guest', 'mom', …)
  personName: string;
  text: string; // the sentence people read
  data?: Record<string, unknown>;
}
export interface AuditEntry extends AuditInput {
  seq: number;
  ts: number;
  day: string; // household-local date
  prev: string;
  hash: string;
}

export const GENESIS = 'GENESIS';
export const AUDIT_TTL_DAYS = 90; // privacy: entries expire after 90 days; daily checkpoints keep the chain checkable
const auditKey = (seq: number) => `AUDIT#${String(seq).padStart(10, '0')}`;

function canonical(e: Omit<AuditEntry, 'hash'>): string {
  // fixed field order → the same bytes every time
  return JSON.stringify([e.seq, e.ts, e.day, e.kind, e.category, e.person, e.personName, e.text, e.data ?? null, e.prev]);
}
export const hashEntry = (e: Omit<AuditEntry, 'hash'>): string => createHash('sha256').update(canonical(e)).digest('hex');

// Optimistic concurrency on the HEAD row: two writers can never both take sequence N+1.
export async function appendAudit(deps: Deps, hh: string, tz: string, i: AuditInput): Promise<AuditEntry> {
  const pk = Store.hk(hh);
  const ts = (deps.now ?? Date.now)();
  const day = localDate(ts, tz);
  for (let attempt = 0; attempt < 25; attempt++) {
    const head = await deps.store.get(pk, 'AUDITHEAD');
    const seq = (head?.seq ?? 0) + 1;
    const prev = head?.hash ?? GENESIS;
    const base = { ...i, seq, ts, day, prev };
    const entry: AuditEntry = { ...base, hash: hashEntry(base) };
    const ttl = Math.floor(ts / 1000) + AUDIT_TTL_DAYS * 86400;
    const items: any[] = [
      { Put: { TableName: deps.store.table, Item: { pk, sk: auditKey(seq), ...entry, ttl }, ConditionExpression: 'attribute_not_exists(pk)' } },
      head
        ? { Update: { TableName: deps.store.table, Key: { pk, sk: 'AUDITHEAD' }, UpdateExpression: 'SET seq = :n, #h = :h, #d = :d', ConditionExpression: 'seq = :old', ExpressionAttributeNames: { '#h': 'hash', '#d': 'day' }, ExpressionAttributeValues: { ':n': seq, ':h': entry.hash, ':d': day, ':old': head.seq } } }
        : { Put: { TableName: deps.store.table, Item: { pk, sk: 'AUDITHEAD', seq, hash: entry.hash, day }, ConditionExpression: 'attribute_not_exists(pk)' } },
    ];
    // a new day starts: seal the previous day with a checkpoint (kept longer than the entries, so old rows can be deleted)
    if (head && head.day !== day) items.push({ Put: { TableName: deps.store.table, Item: { pk, sk: `CHK#${head.day}`, day: head.day, seq: head.seq, hash: head.hash, ttl: Math.floor(ts / 1000) + 400 * 86400 } } });
    try {
      await deps.store.transact(items);
      return entry;
    } catch (e: any) {
      if (e?.name !== 'TransactionCanceledException') throw e;
    }
  }
  throw new Error('audit busy');
}

// Best effort for callers whose action already happened: an audit failure must be loud in logs but must not undo a result.
export async function tryAudit(deps: Deps, hh: string, tz: string, i: AuditInput): Promise<void> {
  try {
    await appendAudit(deps, hh, tz, i);
  } catch (e) {
    console.error('AUDIT WRITE FAILED', i.kind, e);
  }
}

export interface VerifyResult {
  ok: boolean;
  checked: number;
  anchored: boolean; // the oldest remaining entry links to a stored checkpoint (or to the start of the log)
  badSeq?: number;
  reason?: string;
}

export async function verifyAudit(store: Store, hh: string): Promise<VerifyResult> {
  const pk = Store.hk(hh);
  const rows = (await store.query(pk, 'AUDIT#')) as unknown as AuditEntry[];
  const head = await store.get(pk, 'AUDITHEAD');
  if (!rows.length) return head ? { ok: false, checked: 0, anchored: false, reason: 'the log is empty but a record of entries exists' } : { ok: true, checked: 0, anchored: true };
  const checkpoints = (await store.query(pk, 'CHK#')) as unknown as { seq: number; hash: string }[];
  const first = rows[0];
  const before = first.seq === 1 ? GENESIS : checkpoints.find((c) => c.seq === first.seq - 1)?.hash;
  const anchored = before !== undefined && before === first.prev;
  if (before !== undefined && before !== first.prev) return { ok: false, checked: 0, anchored: false, badSeq: first.seq, reason: 'the first entry does not link to its checkpoint' };
  let prevHash = first.prev;
  let prevSeq = first.seq - 1;
  for (const r of rows) {
    const { hash, ...rest } = r as any;
    const base = { seq: rest.seq, ts: rest.ts, day: rest.day, kind: rest.kind, category: rest.category, person: rest.person, personName: rest.personName, text: rest.text, data: rest.data, prev: rest.prev } as Omit<AuditEntry, 'hash'>;
    if (r.seq !== prevSeq + 1) return { ok: false, checked: r.seq, anchored, badSeq: prevSeq + 1, reason: 'an entry is missing' };
    if (r.prev !== prevHash) return { ok: false, checked: r.seq, anchored, badSeq: r.seq, reason: 'an entry does not link to the one before it' };
    if (hashEntry(base) !== hash) return { ok: false, checked: r.seq, anchored, badSeq: r.seq, reason: 'an entry was edited' };
    prevHash = hash;
    prevSeq = r.seq;
  }
  if (!head || head.seq !== prevSeq || head.hash !== prevHash) return { ok: false, checked: rows.length, anchored, badSeq: prevSeq + 1, reason: 'the end of the log was cut off' };
  return { ok: true, checked: rows.length, anchored };
}

export async function readAudit(store: Store, hh: string, f: { person?: string; day?: string; category?: Category; limit?: number } = {}): Promise<AuditEntry[]> {
  const rows = (await store.query(Store.hk(hh), 'AUDIT#', { reverse: true })) as unknown as AuditEntry[];
  return rows.filter((r) => (!f.person || r.person === f.person) && (!f.day || r.day === f.day) && (!f.category || r.category === f.category)).slice(0, f.limit ?? 50);
}
