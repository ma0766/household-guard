import { existsSync, readFileSync } from 'node:fs';
import { mintToken } from '../src/auth.js';

// smoke: initialize → tools/list → tools/call against HG_URL (deployed) or the local server
const env: Record<string, string> = {};
if (existsSync('.env.deploy')) for (const l of readFileSync('.env.deploy', 'utf8').split('\n')) { const [k, ...v] = l.split('='); if (k) env[k] = v.join('='); }
const base = process.env.HG_URL ?? env.HG_URL;
if (!base) { console.error('No HG_URL. Run npm run deploy first.'); process.exit(1); }
if (!process.env.HG_TOKEN_SECRET) process.env.HG_TOKEN_SECRET = env.HG_TOKEN_SECRET;

const token = mintToken('smoke', 300);
let id = 1;
async function rpc(method: string, params?: unknown) {
  const r = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} → ${r.status} ${text}`);
  return JSON.parse(text);
}
const t0 = Date.now();
const init = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
console.log('initialize ✓', init.result.protocolVersion);
const list = await rpc('tools/list');
console.log('tools/list ✓', list.result.tools.map((t: any) => t.name).join(', '));
const call = await rpc('tools/call', { name: 'household_status', arguments: {} });
console.log('tools/call ✓', call.result.content[0].text);
const bad = await fetch(`${base}/mcp`, { method: 'POST', headers: { origin: 'https://evil.example', authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
if (bad.status !== 403) throw new Error(`bad Origin should be 403, got ${bad.status}`);
console.log('bad Origin → 403 ✓');
console.log(`smoke passed in ${Date.now() - t0} ms against ${base}`);
