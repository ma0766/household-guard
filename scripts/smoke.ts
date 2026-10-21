import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mintToken } from '../src/auth.js';

// smoke: initialize → tools/list → tools/call against HG_URL (deployed) or the local server
const env: Record<string, string> = {};
import { currentStage } from './stage.js';
const envFile = currentStage().envFile;
if (existsSync(envFile)) for (const l of readFileSync(envFile, 'utf8').split('\n')) { const [k, ...v] = l.split('='); if (k) env[k] = v.join('='); }
const base = process.env.HG_URL ?? env.HG_URL;
if (!base) { console.error('No HG_URL. Run npm run deploy first.'); process.exit(1); }
if (!process.env.HG_TOKEN_SECRET) process.env.HG_TOKEN_SECRET = env.HG_TOKEN_SECRET;

const hh = `smoke${Date.now()}`; // a fresh household each run
const token = mintToken('smoke', 300, hh);
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
const act = await rpc('tools/call', { name: 'request_action', arguments: { service: 'sim-home', action: 'light', item: 'lights', value: 'off' } });
const out = act.result.structuredContent;
if (out.outcome !== 'allowed' || !out.done) throw new Error(`guest lights should be allowed and done: ${JSON.stringify(out)}`);
console.log('request_action (guest, lights) ✓', out.say);
const unlock = (await rpc('tools/call', { name: 'request_action', arguments: { service: 'sim-home', action: 'unlock', item: 'front door' } })).result.structuredContent;
if (unlock.outcome !== 'denied') throw new Error(`guest unlock must be denied: ${JSON.stringify(unlock)}`);
console.log('request_action (guest, unlock) denied ✓', unlock.say);
// a real ride end to end on the deployed stack: phone confirm → request → phone tap → queue → worker Lambda → booked
const tool = async (name: string, args: Record<string, unknown>) => (await rpc('tools/call', { name, arguments: args })).result.structuredContent;
const phone = async (person: string, what: string, body: unknown) => {
  const r = await fetch(`${base}/phone/${person}/${what}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${mintToken(person, 300, hh, 'phone')}` }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`phone ${what} → ${r.status} ${await r.text()}`);
  return r.json();
};
const login = await tool('confirm_identity', { name: 'Maya' });
const loginTap = await phone('maya', 'confirm', { challenge_id: login.challenge_id, number: login.number });
if (loginTap.status !== 'confirmed') throw new Error(`Maya should be confirmed: ${JSON.stringify(loginTap)}`);
const ride = await tool('request_action', { service: 'mock-ride', action: 'purchase', item: 'ride to the mall' });
if (ride.outcome !== 'allowed' || ride.done !== false || !ride.job_id) throw new Error(`teen $15 ride should wait for her tap: ${JSON.stringify(ride)}`);
const rideTap = await phone('maya', 'confirm', { challenge_id: ride.job_id, number: ride.number });
if (rideTap.status !== 'confirmed') throw new Error(`ride tap failed: ${JSON.stringify(rideTap)}`);
let job: any;
for (let i = 0; i < 30; i++) {
  job = await tool('job_status', { job_id: ride.job_id });
  if (['done', 'held', 'failed'].includes(job.status)) break;
  await new Promise((r) => setTimeout(r, 1000));
}
if (job.status !== 'done') throw new Error(`ride should be booked by the worker: ${JSON.stringify(job)}`);
console.log('ride booked through the queue and worker ✓', job.say);
const none = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
if (none.status !== 401) throw new Error(`no token should be 401, got ${none.status}`);
console.log('no token → 401 ✓');
const meta = await fetch(`${base}/.well-known/oauth-protected-resource`);
if (!meta.ok) throw new Error('well-known metadata missing');
console.log('well-known metadata ✓');
const bad = await fetch(`${base}/mcp`, { method: 'POST', headers: { origin: 'https://evil.example', authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
if (bad.status !== 403) throw new Error(`bad Origin should be 403, got ${bad.status}`);
console.log('bad Origin → 403 ✓');
// ---- sign-in with the real family-account server (only when this stage has one) ----
if (env.HG_POOL_ID && env.HG_TEST_PASSWORD) {
  const aws = (args: string[]) => JSON.parse(execFileSync('aws', [...args, '--region', 'us-east-1', '--output', 'json'], { encoding: 'utf8' }));
  const callWith = async (bearer: string, name: string) => {
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${bearer}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/call', params: { name, arguments: {} } }) });
    return { status: r.status, text: await r.text() };
  };
  const login = aws(['cognito-idp', 'initiate-auth', '--auth-flow', 'USER_PASSWORD_AUTH', '--client-id', env.HG_WEB_CLIENT_ID, '--auth-parameters', `USERNAME=${env.HG_TEST_USER},PASSWORD=${env.HG_TEST_PASSWORD}`]).AuthenticationResult;
  const mine = await callWith(login.AccessToken, 'household_status');
  if (mine.status !== 200 || !mine.text.includes('house is quiet') && !mine.text.includes('waiting')) throw new Error(`a signed-in family account should open its house: ${mine.status} ${mine.text.slice(0, 200)}`);
  console.log('family account (real sign-in server) → house_status ✓');
  const id = await callWith(login.IdToken, 'household_status');
  if (id.status !== 401) throw new Error(`an ID token must be refused, got ${id.status}`);
  console.log('ID token refused (401) ✓');
  const noPhone = await fetch(`${base}/phone/mom/inbox`, { headers: { authorization: `Bearer ${login.AccessToken}` } });
  if (noPhone.status !== 403) throw new Error(`a signed-in token must never act as a phone, got ${noPhone.status}`);
  console.log('signed-in token cannot act as a phone (403) ✓');
  const client = aws(['cognito-idp', 'describe-user-pool-client', '--user-pool-id', env.HG_POOL_ID, '--client-id', env.HG_SERVICE_CLIENT_ID]).UserPoolClient;
  const tok = await fetch(`${env.HG_SIGN_IN_DOMAIN}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${client.ClientId}:${client.ClientSecret}`).toString('base64')}` }, body: 'grant_type=client_credentials&scope=hg%2Fmcp' });
  const svc = (await tok.json()) as { access_token?: string };
  if (!svc.access_token) throw new Error('client_credentials token was not issued');
  const sv = await callWith(svc.access_token, 'household_status');
  if (sv.status !== 200) throw new Error(`a service token should open the service house, got ${sv.status}`);
  console.log('service client (client_credentials) → house_status ✓');
  const cfg = (await (await fetch(`${base}/config.json`)).json()) as { sign_in: { authorize_url: string } | null };
  if (!cfg.sign_in?.authorize_url.startsWith(env.HG_SIGN_IN_DOMAIN)) throw new Error('config.json should point at the sign-in domain');
  console.log('config.json points at the sign-in domain ✓');
}
console.log(`smoke passed in ${Date.now() - t0} ms against ${base}`);
