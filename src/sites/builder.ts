import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Store } from '../core/store.js';
import { esc } from '../audit/views.js';

// Builds and publishes a one-page site. In production that is Wix's MCP server (create, update, publish); with no Wix keys a
// stand-in with the same interface builds the page in our own table and serves it at /preview/<id>.
export interface SiteBuilder {
  readonly kind: 'wix' | 'stand-in';
  create(name: string): Promise<{ id: string }>;
  write(id: string, name: string, brief: string): Promise<void>;
  publish(id: string): Promise<{ url: string }>;
  remove(id: string): Promise<void>; // a half-made draft is never left behind
}

// The business name from what was said. Tags and code are cut out FIRST; only plain letters are kept; at most 40.
export function siteNameOf(item: string | undefined): string {
  let t = String(item ?? '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]*>/g, ' ');
  t = t.replace(/[^A-Za-z0-9 ,.'&-]/g, ' ').replace(/\s+/g, ' ').trim();
  const comma = t.lastIndexOf(',');
  if (comma >= 0 && t.slice(comma + 1).trim()) t = t.slice(comma + 1).trim();
  else {
    const m = /\b(?:called|named)\s+(.+)$/i.exec(t) ?? /\bfor\s+(?:my|the|our|a)?\s*(.+)$/i.exec(t);
    if (m) t = m[1].trim();
  }
  t = t.replace(/^(my|the|our)\s+/i, '').slice(0, 40).trim();
  return t || 'My site';
}

const PAGE = (name: string, brief: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(name)}</title><style>body{font:18px/1.5 Georgia,serif;margin:0;color:#3b2a1a;background:#fff8ee}header{padding:48px 24px;text-align:center;background:#f3d9b1}h1{margin:0;font-size:40px}main{max-width:560px;margin:0 auto;padding:24px}</style></head><body><header><h1>${esc(name)}</h1><p>Fresh and local.</p></header><main><p>Welcome to ${esc(name)}.</p><p>${esc(brief.slice(0, 200))}</p><p>Come by and say hello.</p></main></body></html>`;

export class StandInSiteBuilder implements SiteBuilder {
  readonly kind = 'stand-in' as const;
  sites: { id: string; name: string; published: boolean }[] = []; // tests only
  steps: { name: string }[] = []; // tests only
  progressSeen: number[] = []; // tests only
  pauseAt?: { step: string; wait: Promise<void> }; // tests only
  failAt?: string; // tests only
  constructor(private store: Store, private base = process.env.HG_PUBLIC_URL ?? 'http://127.0.0.1:8016') {}
  observe(p: number) { this.progressSeen.push(p); }
  private async gate(step: string) {
    this.steps.push({ name: step });
    if (this.pauseAt?.step === step) await this.pauseAt.wait;
    if (this.failAt === step) throw new Error(`stand-in failed at ${step}`);
  }
  async create(name: string) {
    await this.gate('create');
    const id = randomBytes(12).toString('base64url');
    await this.store.put({ pk: `SITE#${id}`, sk: 'SITE', name, html: '', published: false, ttl: Math.floor(Date.now() / 1000) + 30 * 86400 });
    this.sites.push({ id, name, published: false });
    return { id };
  }
  async write(id: string, name: string, brief: string) {
    await this.gate('write');
    const row = await this.store.get(`SITE#${id}`, 'SITE');
    await this.store.put({ ...(row as any), pk: `SITE#${id}`, sk: 'SITE', html: PAGE(name, brief) });
  }
  async publish(id: string) {
    await this.gate('publish');
    const row = await this.store.get(`SITE#${id}`, 'SITE');
    await this.store.put({ ...(row as any), pk: `SITE#${id}`, sk: 'SITE', published: true });
    const s = this.sites.find((x) => x.id === id);
    if (s) s.published = true;
    return { url: `${this.base.replace(/\/$/, '')}/preview/${id}` };
  }
  async remove(id: string) {
    await this.store.delete(`SITE#${id}`, 'SITE');
    this.sites = this.sites.filter((s) => s.id !== id);
  }
  // the published page only (a draft is never served)
  async html(id: string): Promise<string | undefined> {
    const row = await this.store.get(`SITE#${id}`, 'SITE');
    return row?.published ? (row.html as string) : undefined;
  }
}

// ---- Wix (MCP server; sign-in with an API key and an account id). UNVERIFIED: written without a Wix key. ----
interface ClientLike { callTool(c: { name: string; arguments?: Record<string, unknown> }): Promise<any>; close(): Promise<void> }
export class WixMcpSiteBuilder implements SiteBuilder {
  readonly kind = 'wix' as const;
  constructor(private connect: () => Promise<ClientLike>, private tools = { create: 'create_site', write: 'update_site', publish: 'publish_site', remove: 'delete_site' }) {}
  private async call(name: string, args: Record<string, unknown>): Promise<any> {
    const c = await this.connect();
    try {
      const r = await c.callTool({ name, arguments: args });
      if (r?.isError) throw new Error('the site service said no');
      return JSON.parse(r?.content?.find((x: any) => x.type === 'text')?.text ?? '{}');
    } finally {
      await c.close().catch(() => undefined);
    }
  }
  async create(name: string) {
    const j = await this.call(this.tools.create, { name });
    if (typeof j.siteId !== 'string') throw new Error('no site id');
    return { id: j.siteId };
  }
  async write(id: string, name: string, brief: string) {
    await this.call(this.tools.write, { siteId: id, title: name, text: brief.slice(0, 500) });
  }
  async publish(id: string) {
    const j = await this.call(this.tools.publish, { siteId: id });
    if (typeof j.url !== 'string' || !/^https:\/\//.test(j.url)) throw new Error('no address');
    return { url: j.url };
  }
  async remove(id: string) {
    await this.call(this.tools.remove, { siteId: id }).catch(() => undefined);
  }
}

export function defaultSiteBuilder(store: Store): SiteBuilder {
  const key = process.env.WIX_API_KEY;
  const account = process.env.WIX_ACCOUNT_ID;
  if (!key || !account) return new StandInSiteBuilder(store);
  const url = process.env.HG_WIX_MCP_URL ?? 'https://mcp.wix.com/mcp';
  return new WixMcpSiteBuilder(async () => {
    const c = new Client({ name: 'household-guard', version: '1' });
    await c.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: key, 'wix-account-id': account } } }));
    return c as unknown as ClientLike;
  });
}
