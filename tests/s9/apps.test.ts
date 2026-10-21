import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/server.js';
import { mintToken } from '../../src/auth.js';
import { Store } from '../../src/core/store.js';
import { localClient } from '../../src/core/local-dynamo.js';
import { ensureSeeded, setSession } from '../../src/core/household.js';
import { BANNED_WORDS } from '../../src/text.js';
import { newHousehold } from '../helpers.js';

// S9: screens as MCP Apps — a ui:// page linked from the tool result, drawn by the host in a sandboxed frame.
let server: Server;
let base: string;
beforeAll(async () => {
  server = createApp((await newHousehold()).deps); // same local table the tests read and write
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

const URI = 'ui://household-guard/screen';
let id = 1;
async function house() {
  const hh = `t${randomUUID().slice(0, 8)}`;
  const store = new Store(localClient());
  await ensureSeeded(store, hh);
  const token = mintToken('web', 300, hh);
  const rpc = async (method: string, params?: unknown) => {
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }) });
    return (await r.json()) as any;
  };
  const call = async (name: string, args: Record<string, unknown> = {}) => (await rpc('tools/call', { name, arguments: args })).result;
  return { hh, store, rpc, call };
}
type House = Awaited<ReturnType<typeof house>>;

async function heldAirport(h: House) {
  await setSession(h.store, h.hh, 'maya', 'phone');
  const r = (await h.call('request_action', { service: 'mock-ride', action: 'purchase', item: 'ride to the airport' })).structuredContent;
  expect(r.outcome).toBe('held');
  return r;
}

describe('S9 the screen is a linked page, not loose HTML', () => {
  it('show_on_screen points at a ui:// page; no other tool does', async () => {
    const h = await house();
    const tools = (await h.rpc('tools/list')).result.tools as any[];
    expect(tools.find((t) => t.name === 'show_on_screen')._meta.ui.resourceUri).toBe(URI);
    expect(tools.filter((t) => t._meta?.ui).map((t) => t.name)).toEqual(['show_on_screen']);
  });
  it('the page can be listed and read, with the app mime type', async () => {
    const h = await house();
    const list = (await h.rpc('resources/list')).result.resources as any[];
    expect(list.find((x) => x.uri === URI)).toMatchObject({ mimeType: 'text/html;profile=mcp-app' });
    const read = (await h.rpc('resources/read', { uri: URI })).result.contents[0];
    expect(read).toMatchObject({ uri: URI, mimeType: 'text/html;profile=mcp-app' });
    expect(read.text).toContain('<!doctype html>');
  });
  it('the page is closed in: no outside addresses, no innerHTML, no eval, a locked-down content rule', async () => {
    const h = await house();
    const html = (await h.rpc('resources/read', { uri: URI })).result.contents[0].text as string;
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/innerHTML|outerHTML|document\.write|eval\(|new Function/);
    expect(html).toMatch(/Content-Security-Policy[^>]*default-src 'none'/);
    expect(html).toContain('ui/initialize');
  });
  it('the words on the page have no tech words', async () => {
    const h = await house();
    const html = (await h.rpc('resources/read', { uri: URI })).result.contents[0].text as string;
    const labels = [...html.matchAll(/\bsay\('([^']+)'\)|\blabel\('([^']+)'\)/g)].map((m) => m[1] ?? m[2]).join(' ').toLowerCase();
    expect(labels.length).toBeGreaterThan(10);
    for (const w of BANNED_WORDS) expect(labels).not.toMatch(new RegExp(`\\b${w}\\b`));
  });
  it('an unknown page is refused', async () => {
    const h = await house();
    expect((await h.rpc('resources/read', { uri: 'ui://household-guard/other' })).error).toBeTruthy();
  });
});

describe('S9 what the page is given', () => {
  it('the approvals screen gives an adult cards with who, what, price, why — and the number', async () => {
    const h = await house();
    const held = await heldAirport(h);
    await setSession(h.store, h.hh, 'mom', 'phone');
    const out = (await h.call('show_on_screen', { view: 'approvals' })).structuredContent;
    expect(out.html).toContain('Maya'); // the old HTML view still works
    expect(out.data.view).toBe('approvals');
    expect(out.data.cards).toHaveLength(1);
    expect(out.data.cards[0]).toMatchObject({ id: held.approval_id, who: 'Maya', what: 'ride to the airport', price_cents: 3800, why: "Held: over Maya's $20 a week.", number: held.number });
  });
  it('a teen sees her own card but never the number; a guest sees nothing', async () => {
    const h = await house();
    await heldAirport(h);
    const mine = (await h.call('show_on_screen', { view: 'approvals' })).structuredContent;
    expect(mine.data.cards).toHaveLength(1);
    expect(mine.data.cards[0].number).toBeUndefined();
    await h.store.delete(Store.hk(h.hh), 'SESSION#current');
    const guest = (await h.call('show_on_screen', { view: 'approvals' })).structuredContent;
    expect(guest.data).toBeUndefined();
  });
  it('orders and timeline screens give rows with an icon, a sentence and a day', async () => {
    const h = await house();
    await heldAirport(h);
    await setSession(h.store, h.hh, 'mom', 'phone');
    const tl = (await h.call('show_on_screen', { view: 'timeline' })).structuredContent;
    expect(tl.data.view).toBe('timeline');
    expect(tl.data.rows[0]).toMatchObject({ icon: expect.any(String), text: expect.stringContaining('Maya'), day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });
});

describe('S9 the Yes button on the screen is a real approval', () => {
  it('a card’s Yes (approve_request with its id and number) books the ride; the old card is gone', async () => {
    const h = await house();
    const held = await heldAirport(h);
    await setSession(h.store, h.hh, 'mom', 'phone', Date.now() + 1000); // Mom's phone tap, after the request
    const card = (await h.call('show_on_screen', { view: 'approvals' })).structuredContent.data.cards[0];
    const ok = (await h.call('approve_request', { approval_id: card.id, number: card.number, decision: 'yes' })).structuredContent;
    expect(ok.job_id).toBeTruthy();
    let job: any;
    for (let i = 0; i < 40; i++) {
      job = (await h.call('job_status', { job_id: ok.job_id })).structuredContent;
      if (job.status === 'done' || job.status === 'failed' || job.status === 'held') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(job.status).toBe('done');
    expect((await h.call('show_on_screen', { view: 'approvals' })).structuredContent.data.cards).toHaveLength(0);
    expect(held.approval_id).toBe(card.id);
  });
  it('a teen’s screen cannot approve: the same call from a non-adult is refused', async () => {
    const h = await house();
    const held = await heldAirport(h);
    const no = (await h.call('approve_request', { approval_id: held.approval_id, number: held.number, decision: 'yes' })).structuredContent;
    expect(no.job_id).toBeUndefined();
    expect(JSON.stringify(no)).not.toMatch(/booked/i);
  });
});
