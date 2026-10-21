import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/server.js';
import { mintToken } from '../../src/auth.js';

let server: Server;
let base: string;
const house = `s0-${Date.now()}-${Math.floor(Math.random() * 1e6)}`; // a fresh house: this test must not depend on what a demo left in the shared table
const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  authorization: `Bearer ${mintToken('s0-test', 300, house)}`,
  ...extra,
});
const post = (body: unknown, h: Record<string, string> = headers()) => fetch(`${base}/mcp`, { method: 'POST', headers: h, body: JSON.stringify(body) });

beforeAll(async () => {
  server = createApp();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

describe('S0 walking skeleton', () => {
  it.each(['2025-11-25', '2025-03-26'])('accepts protocol version %s on initialize', async (v) => {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: v, capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    expect(r.status).toBe(200);
    const j: any = await r.json();
    expect(j.result.protocolVersion).toBe(v);
  });

  it('lists household_status and answers a call', async () => {
    const list: any = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
    expect(list.result.tools.map((t: any) => t.name)).toContain('household_status');
    const call: any = await (await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'household_status', arguments: {} } })).json();
    expect(call.result.content[0].text).toMatch(/quiet/);
  });

  it('returns 403 for a bad Origin header', async () => {
    const r = await post({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, headers({ origin: 'https://evil.example' }));
    expect(r.status).toBe(403);
  });

  it('accepts a request with no Origin (CLI clients)', async () => {
    const r = await post({ jsonrpc: '2.0', id: 5, method: 'tools/list' });
    expect(r.status).toBe(200);
  });

  it('returns 401 without a valid bearer token', async () => {
    const r = await post({ jsonrpc: '2.0', id: 6, method: 'tools/list' }, { 'content-type': 'application/json', accept: 'application/json, text/event-stream' });
    expect(r.status).toBe(401);
    const bad = await post({ jsonrpc: '2.0', id: 7, method: 'tools/list' }, headers({ authorization: 'Bearer nope.nope' }));
    expect(bad.status).toBe(401);
  });
});
