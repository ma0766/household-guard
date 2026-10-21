import { randomBytes } from 'node:crypto';
import { Store } from '../core/store.js';

// The connector hub: one place that knows which apps exist, who signed in to which, and how to act as that person.
// In production it is Composio (every sign-in belongs to a userID we choose: "household:person"). Without a Composio key
// a stand-in with the SAME interface keeps its own records, so everything above it is the same code and the same tests.
export interface Toolkit { slug: string; name: string; description: string }
export type ConnState = 'connected' | 'pending' | 'expired' | 'not_connected';
export interface Connection { id: string; toolkit: string; state: ConnState }
export interface ExecResult { ok: boolean; error?: string }
export interface ConnectorHub {
  readonly kind: 'composio' | 'stand-in';
  toolkits(): Promise<Toolkit[]>;
  initiate(userId: string, toolkit: string): Promise<{ connectionId: string; link: string }>;
  connection(userId: string, toolkit: string): Promise<Connection | undefined>;
  execute(userId: string, toolkit: string, action: string, params: Record<string, unknown>): Promise<ExecResult>;
}

export const userIdOf = (hh: string, person: string) => `${hh}:${person}`;
export const SLUG = /^[a-z0-9-]{1,40}$/;
export function parseUserId(u: string): { hh: string; person: string } | undefined {
  const m = /^([a-z0-9-]{1,32}):([a-z0-9-]{1,32})$/.exec(u);
  return m ? { hh: m[1], person: m[2] } : undefined;
}

// ---- stand-in (no COMPOSIO_API_KEY): sign-ins live in our own table, one record per person per app ----
const CATALOG: Toolkit[] = [
  { slug: 'spotify', name: 'Spotify', description: 'music songs playlists' },
  { slug: 'google-calendar', name: 'Google Calendar', description: 'calendar events schedule' },
  { slug: 'todoist', name: 'Todoist', description: 'tasks to-do lists chores' },
];

export class StandInHub implements ConnectorHub {
  readonly kind = 'stand-in' as const;
  calls: { userId: string; toolkit: string; action: string }[] = []; // tests only
  hostileReply?: string; // tests only: what a hostile app would say back
  failNext = false; // tests only
  constructor(private store: Store, private base = process.env.HG_PUBLIC_URL ?? 'https://connect.stand-in.example') {}

  async toolkits(): Promise<Toolkit[]> {
    return CATALOG;
  }
  private key(userId: string, toolkit: string) {
    const u = parseUserId(userId);
    if (!u || !SLUG.test(toolkit)) throw new Error('bad id');
    return { pk: Store.hk(u.hh), sk: `HUB#${u.person}#${toolkit}`, hh: u.hh };
  }
  async initiate(userId: string, toolkit: string) {
    const k = this.key(userId, toolkit);
    const connectionId = `${k.hh}~${randomBytes(12).toString('base64url')}`;
    await this.store.put({ pk: k.pk, sk: k.sk, userId, toolkit, connectionId, state: 'pending', at: Date.now() });
    await this.store.put({ pk: k.pk, sk: `HUBCONN#${connectionId}`, userId, toolkit, ttl: Math.floor(Date.now() / 1000) + 3600 });
    return { connectionId, link: `${this.base.replace(/\/$/, '')}/standin/connect/${connectionId}` };
  }
  // the person finishes on the provider's page (here: our own "Allow" page). A different key per person.
  async complete(connectionId: string): Promise<boolean> {
    const hh = connectionId.split('~')[0];
    if (!/^[a-z0-9-]{1,32}$/.test(hh)) return false;
    const c = await this.store.get(Store.hk(hh), `HUBCONN#${connectionId}`);
    if (!c || Number(c.ttl) * 1000 < Date.now()) return false; // unknown, used, or older than an hour (the table's own expiry is lazy)
    const k = this.key(c.userId as string, c.toolkit as string);
    const cur = await this.store.get(k.pk, k.sk);
    if (!cur || cur.connectionId !== connectionId || cur.state !== 'pending') return false; // a newer link replaced this one, or it was already used
    await this.store.delete(Store.hk(hh), `HUBCONN#${connectionId}`); // a link works once
    await this.store.put({ pk: k.pk, sk: k.sk, userId: c.userId, toolkit: c.toolkit, connectionId, state: 'connected', key: randomBytes(24).toString('base64url'), at: Date.now() });
    return true;
  }
  async connection(userId: string, toolkit: string): Promise<Connection | undefined> {
    const k = this.key(userId, toolkit);
    const r = await this.store.get(k.pk, k.sk);
    return r ? { id: r.connectionId as string, toolkit, state: r.state as ConnState } : undefined;
  }
  async expire(userId: string, toolkit: string): Promise<void> {
    const k = this.key(userId, toolkit);
    const r = await this.store.get(k.pk, k.sk);
    if (r) await this.store.put({ ...r, pk: k.pk, sk: k.sk, state: 'expired' });
  }
  async execute(userId: string, toolkit: string, action: string): Promise<ExecResult> {
    this.calls.push({ userId, toolkit, action });
    if (this.failNext) {
      this.failNext = false;
      return { ok: false, error: 'the app did not answer' };
    }
    const c = await this.connection(userId, toolkit);
    return c?.state === 'connected' ? { ok: true } : { ok: false, error: 'not connected' };
  }
  async _peekKey(userId: string, toolkit: string): Promise<string | undefined> {
    const k = this.key(userId, toolkit);
    return (await this.store.get(k.pk, k.sk))?.key as string | undefined;
  }
}

// ---- Composio: asks Composio, acting as userID "household:person". Any error is a "no". ----
interface ComposioClientLike {
  toolkits: { get(): Promise<any[]> };
  connectedAccounts: { initiate(userId: string, authConfigId: string): Promise<{ id: string; redirectUrl: string }>; list(q: any): Promise<{ items: any[] }> };
  tools: { execute(slug: string, o: { userId: string; arguments: Record<string, unknown>; dangerouslySkipVersionCheck?: boolean }): Promise<{ successful?: boolean }> };
}
// UNVERIFIED against the live service (no key here): the tool each "use this app" ask maps to
const TOOL_SLUGS: Record<string, Record<string, string>> = { spotify: { use_app: 'SPOTIFY_START_RESUME_PLAYBACK' }, 'google-calendar': { use_app: 'GOOGLECALENDAR_EVENTS_LIST' } };
const STATE: Record<string, ConnState> = { ACTIVE: 'connected', INITIATED: 'pending', INITIALIZING: 'pending', EXPIRED: 'expired', FAILED: 'expired', INACTIVE: 'expired' };

export class ComposioHub implements ConnectorHub {
  readonly kind = 'composio' as const;
  constructor(private client: ComposioClientLike | (() => Promise<ComposioClientLike>), private authConfigs: Record<string, string> = {}) {}
  private async c(): Promise<ComposioClientLike> {
    return typeof this.client === 'function' ? (this.client = await this.client()) : this.client;
  }
  private cache?: { at: number; list: Toolkit[] };
  async toolkits(): Promise<Toolkit[]> {
    if (this.cache && Date.now() - this.cache.at < 300_000) return this.cache.list; // the catalog is big: not on every ask
    const list = await (await this.c()).toolkits.get();
    const out = list.map((t: any) => ({ slug: String(t.slug).toLowerCase(), name: String(t.name ?? t.slug), description: String(t.meta?.description ?? '') })).filter((t) => SLUG.test(t.slug));
    this.cache = { at: Date.now(), list: out };
    return out;
  }
  async initiate(userId: string, toolkit: string) {
    if (!parseUserId(userId) || !this.authConfigs[toolkit]) throw new Error('not set up');
    const r = await (await this.c()).connectedAccounts.initiate(userId, this.authConfigs[toolkit]);
    return { connectionId: r.id, link: r.redirectUrl };
  }
  async connection(userId: string, toolkit: string): Promise<Connection | undefined> {
    const r = await (await this.c()).connectedAccounts.list({ userIds: [userId], toolkitSlugs: [toolkit] });
    // after a re-link both the old (expired) and the new account are listed: the working one wins, then a pending one, then the rest
    const mine = r.items.filter((i: any) => String(i.toolkit?.slug ?? '').toLowerCase() === toolkit);
    const rank = (i: any) => (STATE[String(i.status).toUpperCase()] === 'connected' ? 0 : STATE[String(i.status).toUpperCase()] === 'pending' ? 1 : 2);
    const x = [...mine].sort((a: any, b: any) => rank(a) - rank(b))[0];
    return x ? { id: String(x.id), toolkit, state: STATE[String(x.status).toUpperCase()] ?? 'expired' } : undefined;
  }
  async execute(userId: string, toolkit: string, action: string, params: Record<string, unknown>): Promise<ExecResult> {
    try {
      const slug = TOOL_SLUGS[toolkit]?.[action];
      if (!slug) return { ok: false, error: 'that app has no matching action' }; // only actions we mapped are ever run
      const r = await (await this.c()).tools.execute(slug, { userId, arguments: params, dangerouslySkipVersionCheck: true });
      return r.successful === true ? { ok: true } : { ok: false, error: 'the app did not say yes' }; // anything but a clear "successful: true" is a no
    } catch {
      return { ok: false, error: 'the app did not answer' };
    }
  }
}

export function defaultHub(store: Store): ConnectorHub {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) return new StandInHub(store);
  // the package is only loaded when a key is set; not installed or not working = every call fails = every ask is held
  const pkg = '@composio/core';
  return new ComposioHub(async () => new ((await import(/* @vite-ignore */ pkg)) as any).Composio({ apiKey: key }), (() => { try { return JSON.parse(process.env.COMPOSIO_AUTH_CONFIGS ?? '{}'); } catch { return {}; } })());
}
