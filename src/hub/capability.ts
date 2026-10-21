import { createHmac, timingSafeEqual } from 'node:crypto';
import { create as qrCreate } from 'qrcode';
import type { Deps } from '../core/request-action.js';
import { Store } from '../core/store.js';
import { getSession, loadHousehold } from '../core/household.js';
import { notifyAdults } from '../identity/guard.js';
import { defaultHub, parseUserId, SLUG, userIdOf, type ConnectorHub, type ConnState } from './hub.js';
import { T } from '../text.js';

export const hubOf = (deps: Deps): ConnectorHub => (deps.hub ??= defaultHub(deps.store));

async function speaker(deps: Deps, hh: string) {
  const s = await getSession(deps.store, hh, (deps.now ?? Date.now)());
  const h = await loadHousehold(deps.store, hh);
  const me = s && h.people.find((p) => p.id === s.personId);
  return me && me.role !== 'guest' && s ? { me, rules: h.rules, session: s } : undefined;
}

// A sign-in the app told us ran out is remembered here until the person connects again.
const expKey = (person: string, toolkit: string) => `CONNEXP#${person}#${toolkit}`;
export async function stateOf(deps: Deps, hh: string, person: string, toolkit: string): Promise<ConnState> {
  if (await deps.store.get(Store.hk(hh), expKey(person, toolkit))) return 'expired';
  return (await hubOf(deps).connection(userIdOf(hh, person), toolkit))?.state ?? 'not_connected';
}

export async function findCapability(deps: Deps, hh: string, a: { query: string }) {
  try {
    const who = await speaker(deps, hh);
    if (!who) return { matches: [], say: T.whoAreYou };
    const q = String(a.query ?? '').toLowerCase().slice(0, 60).trim();
    const words = q.split(/\s+/).filter(Boolean);
    const all = await hubOf(deps).toolkits();
    const hit = all.filter((t) => words.length && words.some((w) => `${t.slug} ${t.name} ${t.description}`.toLowerCase().includes(w)));
    const matches = [];
    for (const t of hit.slice(0, 5)) matches.push({ slug: t.slug, name: t.name, status: await stateOf(deps, hh, who.me.id, t.slug), allowed: who.rules.allowedServices.includes(t.slug) });
    if (!matches.length) return { matches, say: "I don't know that app." };
    const m = matches[0];
    const say = [m.status === 'connected' ? T.appConnected(m.name) : m.status === 'expired' ? T.signInRanOut(m.name) : m.status === 'pending' ? T.appPending(m.name) : T.appNotConnected(m.name), m.allowed ? '' : T.appNeedsAdult].filter(Boolean).join(' ');
    return { matches, say };
  } catch {
    return { matches: [], say: T.oops };
  }
}

const QR_ROWS = 21;
// at most 3 links per person per 10 minutes (one counter per 10-minute window, bumped in a single conditional write)
async function mayLink(deps: Deps, hh: string, person: string, now: number): Promise<boolean> {
  try {
    await deps.store.update({
      Key: { pk: Store.hk(hh), sk: `CONNWIN#${person}#${Math.floor(now / 600_000)}` },
      UpdateExpression: 'ADD n :one SET #t = :ttl',
      ExpressionAttributeNames: { '#t': 'ttl' },
      ConditionExpression: 'attribute_not_exists(n) OR n < :max',
      ExpressionAttributeValues: { ':one': 1, ':max': 3, ':ttl': Math.floor(now / 1000) + 3600 },
    });
    return true;
  } catch (e: any) {
    if (e?.name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}

export async function connectService(deps: Deps, hh: string, a: { toolkit: string }): Promise<{ link?: string; connection_id?: string; qr: { size: number; rows: string[] }; say: string; toolkit?: string; name?: string }> {
  const none = { qr: { size: 0, rows: [] as string[] } };
  try {
    const who = await speaker(deps, hh);
    if (!who) return { ...none, say: T.whoAreYou };
    const slug = String(a.toolkit ?? '');
    const t = SLUG.test(slug) ? (await hubOf(deps).toolkits()).find((x) => x.slug === slug) : undefined;
    if (!t) return { ...none, say: "I don't know that app." };
    const nowMs = (deps.now ?? Date.now)();
    // a link ties an account to this person: it needs THEIR OWN phone tap, just now (not whoever speaks after them)
    if (who.session.method !== 'phone' || nowMs - who.session.confirmedAt > 60_000) return { ...none, say: T.confirmPhone };
    if (!(await mayLink(deps, hh, who.me.id, nowMs))) return { ...none, say: T.locked };
    const { connectionId, link } = await hubOf(deps).initiate(userIdOf(hh, who.me.id), slug);
    await deps.store.delete(Store.hk(hh), expKey(who.me.id, slug)); // she is signing in again: the old "ran out" no longer applies
    const m = qrCreate(link, { errorCorrectionLevel: 'M' }).modules;
    const rows = Array.from({ length: m.size }, (_, y) => Array.from({ length: m.size }, (_, x) => (m.get(x, y) ? '1' : '0')).join(''));
    void QR_ROWS;
    return { link, connection_id: connectionId, toolkit: slug, name: t.name, qr: { size: m.size, rows }, say: T.openLink(t.name) };
  } catch {
    return { ...none, say: T.oops };
  }
}

// The hub tells us a sign-in ran out (Standard Webhooks: webhook-id, webhook-timestamp, webhook-signature "v1,<base64>", signed over
// "<id>.<timestamp>.<body>"). Signed, fresh, once only. Anything odd is ignored: never an error that tells an attacker something.
export interface HookHeaders { id?: string; ts?: string; sig?: string }
export async function handleHubWebhook(deps: Deps, rawBody: string, h: HookHeaders | undefined): Promise<{ status: number }> {
  const secret = process.env.HG_HUB_WEBHOOK_SECRET;
  if (!secret || !h?.id || !h.ts || !h.sig || !/^[A-Za-z0-9_-]{1,100}$/.test(h.id)) return { status: 401 };
  const ts = Number(h.ts);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return { status: 401 }; // five minutes either way
  const key = secret.startsWith('whsec_') ? Buffer.from(secret.slice(6), 'base64') : Buffer.from(secret);
  const want = createHmac('sha256', key).update(`${h.id}.${h.ts}.${rawBody}`).digest();
  const ok = h.sig.split(' ').some((part) => {
    const [v, sig] = part.split(',');
    const got = Buffer.from(sig ?? '', 'base64');
    return v === 'v1' && got.length === want.length && timingSafeEqual(got, want);
  });
  if (!ok) return { status: 401 };
  try {
    await deps.store.put({ pk: 'WEBHOOK', sk: `ID#${h.id}`, ttl: Math.floor(Date.now() / 1000) + 3600 }, { ifNotExists: true });
  } catch (e: any) {
    if (e?.name === 'ConditionalCheckFailedException') return { status: 409 }; // the same message again
    throw e;
  }
  try {
    const e = JSON.parse(rawBody);
    if (e?.type !== 'connected_account.expired') return { status: 200 };
    const u = parseUserId(String(e.data?.user_id ?? ''));
    const slug = String(e.data?.toolkit_slug ?? '').toLowerCase();
    if (!u || !SLUG.test(slug)) return { status: 200 };
    if (!(await deps.store.get(Store.hk(u.hh), 'META'))) return { status: 200 }; // not one of our houses
    const { people } = await loadHousehold(deps.store, u.hh);
    const me = people.find((p) => p.id === u.person);
    if (!me) return { status: 200 };
    const name = (await hubOf(deps).toolkits().catch(() => [])).find((t) => t.slug === slug)?.name ?? slug;
    const now = (deps.now ?? Date.now)();
    await deps.store.put({ pk: Store.hk(u.hh), sk: expKey(u.person, slug), at: now, ttl: Math.floor(now / 1000) + 30 * 86400 });
    await notifyAdults(deps.store, u.hh, `${me.name}'s ${name} sign-in ran out.`, now, me.id, me.name);
  } catch {
    /* a message we cannot read changes nothing */
  }
  return { status: 200 };
}
