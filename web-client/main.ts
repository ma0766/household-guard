// Browser MCP client: plain fetch against the Streamable HTTP endpoint (stateless, JSON responses)
const logEl = document.getElementById('log') as HTMLPreElement;
let token = '';
let nextId = 1;

function log(dir: '→' | '←', obj: unknown) {
  logEl.textContent += `${dir} ${JSON.stringify(obj, null, 1)}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

export async function rpc(method: string, params?: unknown, id: number | undefined = nextId++) {
  const msg = id === undefined ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params };
  log('→', msg);
  const r = await fetch('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
    body: JSON.stringify(msg),
  });
  const text = await r.text();
  const out = text ? JSON.parse(text) : { status: r.status };
  log('←', out);
  return out;
}

async function connect() {
  if (!token) token = (await (await fetch('/demo-token')).json()).token;
  await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'web-client', version: '0.1.0' } });
  await rpc('notifications/initialized', undefined, undefined);
}

document.getElementById('btn-connect')!.onclick = connect;
document.getElementById('btn-tools')!.onclick = async () => { await connect(); await rpc('tools/list'); };
document.getElementById('btn-status')!.onclick = async () => { await connect(); await rpc('tools/call', { name: 'household_status', arguments: {} }); };
