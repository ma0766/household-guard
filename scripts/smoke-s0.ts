import { existsSync, readFileSync } from 'node:fs';
import { mintToken } from '../src/auth.js';
import { currentStage } from './stage.js';

// The S0 check against a deployed stack: the web client's three calls (initialize → tools/list → tools/call), a bad Origin gets 403,
// no sign-in gets 401, and the ten tools are all there. Reads HG_URL from the stage's env file (or the environment).
const env: Record<string, string> = {};
const envFile = currentStage().envFile;
if (existsSync(envFile)) for (const l of readFileSync(envFile, 'utf8').split('\n')) { const [k, ...v] = l.split('='); if (k) env[k] = v.join('='); }
const base = process.env.HG_URL ?? env.HG_URL;
if (!base) { console.error('No HG_URL. Run npm run deploy first.'); process.exit(1); }
if (!process.env.HG_TOKEN_SECRET) process.env.HG_TOKEN_SECRET = env.HG_TOKEN_SECRET;
const token = mintToken('smoke', 300, `s0${Date.now()}`);
let id = 1;
const post = (headers: Record<string, string>, method: string, params?: unknown) =>
  fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }) });
const rpc = async (method: string, params?: unknown) => {
  const r = await post({ authorization: `Bearer ${token}` }, method, params);
  if (!r.ok) throw new Error(`${method} → ${r.status} ${await r.text()}`);
  return JSON.parse(await r.text());
};
const fail = (m: string): never => { console.error(`S0 FAIL: ${m}`); process.exit(1); };

const init = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 's0-smoke', version: '1' } });
if (init.result?.protocolVersion !== '2025-11-25') fail(`initialize said ${JSON.stringify(init.result)}`);
console.log('initialize ✓', init.result.protocolVersion);
const old = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 's0-smoke', version: '1' } });
if (!old.result?.protocolVersion) fail('the older protocol version is not accepted');
console.log('initialize (2025-03-26) ✓', old.result.protocolVersion);
const names: string[] = (await rpc('tools/list')).result.tools.map((t: any) => t.name);
if (names.length !== 10) fail(`expected ten tools, got ${names.length}: ${names.join(', ')}`);
console.log('tools/list ✓', names.join(', '));
const call = await rpc('tools/call', { name: 'household_status', arguments: {} });
if (!call.result?.content?.[0]?.text) fail('household_status gave no answer');
console.log('tools/call ✓', call.result.content[0].text);
const bad = await post({ authorization: `Bearer ${token}`, origin: 'https://evil.example' }, 'tools/list');
if (bad.status !== 403) fail(`a bad Origin must get 403, got ${bad.status}`);
console.log('bad Origin → 403 ✓');
const none = await post({}, 'tools/list');
if (none.status !== 401) fail(`no sign-in must get 401, got ${none.status}`);
console.log('no sign-in → 401 ✓');
console.log(`S0 PASS against ${base}`);
