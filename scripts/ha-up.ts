import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// Starts the official Home Assistant image in Docker (port 8020, claimed in ~/.claude/ports.md), does its first-run setup, and
// writes a long-lived key into .env.ha (gitignored). Safe to run again.
const URL_ = 'http://127.0.0.1:8020';
const FILE = '.env.ha';
const ok = async (token: string) => { try { return (await fetch(`${URL_}/api/`, { headers: { authorization: `Bearer ${token}` } })).ok; } catch { return false; } };

const post = async (path: string, body: unknown, token?: string, form = false) => {
  const r = await fetch(`${URL_}${path}`, { method: 'POST', headers: { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body) });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
let haveKey = false;
if (existsSync(FILE)) {
  const t = /HG_HA_TOKEN=(.+)/.exec(readFileSync(FILE, 'utf8'))?.[1];
  haveKey = typeof t === "string" && (await ok(t as string));
}
if (!haveKey) await setUp();

async function setUp() {
const running = execFileSync('docker', ['ps', '-a', '--filter', 'name=^hg-ha$', '--format', '{{.Status}}'], { encoding: 'utf8' }).trim();
if (!running) {
  execFileSync('docker', ['run', '-d', '--name', 'hg-ha', '--restart', 'unless-stopped', '-p', '127.0.0.1:8020:8123', '-v', `${process.cwd()}/tools/ha/config:/config`, `ghcr.io/home-assistant/home-assistant:${process.env.HA_VERSION ?? 'stable'}`], { stdio: 'inherit' });
} else if (!running.startsWith('Up')) execFileSync('docker', ['start', 'hg-ha'], { stdio: 'inherit' });

for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${URL_}/api/onboarding`)).ok) break; } catch { /* still starting */ }
  await new Promise((r) => setTimeout(r, 4000));
}
};
const steps = (await (await fetch(`${URL_}/api/onboarding`)).json()) as { step: string; done: boolean }[];
if (steps.some((s) => s.step === 'user' && !s.done)) {
  const client_id = `${URL_}/`;
  const made = await post('/api/onboarding/users', { client_id, name: 'Household Guard', username: 'hg', password: randomBytes(18).toString('base64url'), language: 'en' });
  const tok = await post('/auth/token', { grant_type: 'authorization_code', code: made.json.auth_code, client_id }, undefined, true);
  const access = tok.json.access_token as string;
  await post('/api/onboarding/core_config', {}, access);
  await post('/api/onboarding/analytics', {}, access);
  await post('/api/onboarding/integration', { client_id, redirect_uri: `${URL_}/?auth_callback=1` }, access);
  writeFileSync('.ha-bootstrap', access, { mode: 0o600 }); // short-lived: only to ask for the long-lived key below
}
const boot = existsSync('.ha-bootstrap') ? readFileSync('.ha-bootstrap', 'utf8') : '';
if (!boot) throw new Error('Home Assistant was already set up by hand and there is no key. Create a long-lived key in its profile page and put HG_HA_URL and HG_HA_TOKEN in .env.ha.');
const long = await new Promise<string>((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:8020/api/websocket`);
  const t = setTimeout(() => reject(new Error('timeout')), 30000);
  ws.onmessage = (m) => {
    const j = JSON.parse(String(m.data));
    if (j.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: boot }));
    else if (j.type === 'auth_ok') ws.send(JSON.stringify({ id: 1, type: 'auth/long_lived_access_token', client_name: 'household-guard', lifespan: 365 }));
    else if (j.id === 1) { clearTimeout(t); ws.close(); if (j.success) resolve(j.result); else reject(new Error(JSON.stringify(j.error))); }
    else if (j.type === 'auth_invalid') reject(new Error('auth invalid'));
  };
});
writeFileSync(FILE, `HG_HA_URL=${URL_}\nHG_HA_TOKEN=${long}\n`, { mode: 0o600 });
unlinkSync('.ha-bootstrap'); // the short-lived key has done its job
console.log('Home Assistant is set up. Key saved in .env.ha');
}

// The owner chooses which devices Home Assistant's assistants may touch. Locks are hidden by default; the demo exposes the front door.
const exposeKey = /HG_HA_TOKEN=(.+)/.exec(readFileSync(FILE, 'utf8'))![1];
await new Promise<void>((resolve, reject) => {
  const ws = new WebSocket('ws://127.0.0.1:8020/api/websocket');
  const t = setTimeout(() => reject(new Error('timeout')), 30000);
  ws.onmessage = (m) => {
    const j = JSON.parse(String(m.data));
    if (j.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: exposeKey }));
    else if (j.type === 'auth_ok') ws.send(JSON.stringify({ id: 2, type: 'homeassistant/expose_entity', assistants: ['conversation'], entity_ids: ['lock.front_door', 'cover.garage_door', 'light.ceiling_lights', 'climate.heatpump'], should_expose: true }));
    else if (j.id === 2) { clearTimeout(t); ws.close(); if (j.success) resolve(); else reject(new Error(JSON.stringify(j.error))); }
  };
});
// and its MCP server (a settings entry, once)
const entries = (await (await fetch(`${URL_}/api/config/config_entries/entry`, { headers: { authorization: `Bearer ${exposeKey}` } })).json()) as { domain: string }[];
if (!entries.some((e) => e.domain === 'mcp_server')) {
  const flow = await post('/api/config/config_entries/flow', { handler: 'mcp_server', show_advanced_options: false }, exposeKey);
  await post(`/api/config/config_entries/flow/${flow.json.flow_id}`, {}, exposeKey);
}
console.log('Devices exposed and the MCP server is on.');
