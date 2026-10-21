import { readFileSync } from 'node:fs';
import { mintToken } from '../../src/auth.js';
// Part D: standard-MCP checks, raw JSON-RPC, both protocol versions. Usage: tsx partD.ts local|prod
const target = process.argv[2] ?? 'prod';
let base = 'http://127.0.0.1:8016'; let secret = process.env.HG_TOKEN_SECRET;
if (target === 'prod') { const env: Record<string,string> = {}; for (const l of readFileSync('.env.deploy','utf8').split('\n')) { const [k,...v]=l.split('='); if(k) env[k]=v.join('='); } base = env.HG_URL; secret = env.HG_TOKEN_SECRET; }
if (secret) process.env.HG_TOKEN_SECRET = secret;
const tok = mintToken('audit', 600, `auditd${Date.now()}`);
let id = 1; const rows: [string, boolean, string][] = [];
const rec = (n: string, ok: boolean, d = '') => { rows.push([n, ok, d]); console.log(ok ? 'PASS' : 'FAIL', n, d); };
const rpc = async (method: string, params?: unknown, ver?: string) => { const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${tok}`, ...(ver ? { 'mcp-protocol-version': ver } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }) }); const t = await r.text(); let j: any; try { j = JSON.parse(t); } catch { j = t.split('\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5)))[0]; } return { s: r.status, j }; };
for (const v of ['2025-11-25', '2025-03-26']) {
  const i = await rpc('initialize', { protocolVersion: v, capabilities: {}, clientInfo: { name: 'audit', version: '1' } });
  rec(`initialize ${v}`, i.s === 200 && !!i.j?.result?.protocolVersion, `server answered ${i.j?.result?.protocolVersion}`);
  const l = await rpc('tools/list', undefined, v);
  const tools = l.j?.result?.tools ?? [];
  rec(`tools/list ${v}`, l.s === 200 && tools.length === 10, `${tools.length} tools: ${tools.map((t:any)=>t.name).join(',')}`);
  const c = await rpc('tools/call', { name: 'household_status', arguments: {} }, v);
  rec(`tools/call household_status ${v}`, c.s === 200 && !c.j?.result?.isError, '');
  if (v === '2025-11-25') {
    const ra = tools.find((t: any) => t.name === 'request_action');
    const props = Object.keys(ra?.inputSchema?.properties ?? {});
    rec('request_action schema has no person/speaker field', !props.some((p) => /person|speaker|who|user|name/i.test(p)), `fields: ${props.join(', ')}`);
    const defUri = (tools.find((t: any) => t.name === 'show_on_screen')?._meta ?? {})?.ui?.resourceUri;
    rec('show_on_screen tool definition links _meta.ui.resourceUri', typeof defUri === 'string' && defUri.startsWith('ui://'), String(defUri));
    if (defUri) { const rr0 = await rpc('resources/read', { uri: defUri }, v); const c0 = rr0.j?.result?.contents?.[0]; rec('ui:// resource (from definition) can be read', !!c0?.text && /html/.test(c0.mimeType ?? ''), `${c0?.mimeType} ${c0?.text?.length} chars`); }
    const s = await rpc('tools/call', { name: 'show_on_screen', arguments: { view: 'timeline' } }, v);
    const meta = s.j?.result?._meta ?? {}; const uri = meta?.ui?.resourceUri ?? meta['ui/resourceUri'];
    rec('show_on_screen result has _meta.ui.resourceUri', typeof uri === 'string' && uri.startsWith('ui://'), String(uri));
    if (uri) { const rr = await rpc('resources/read', { uri }, v); const ct = rr.j?.result?.contents?.[0]; rec('ui:// resource can be read', !!ct?.text && /html/.test(ct.mimeType ?? ''), `${ct?.mimeType} ${ct?.text?.length} chars`); }
  }
}
process.exit(rows.every((r) => r[1]) ? 0 : 1);
