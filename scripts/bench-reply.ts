import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mintToken } from '../src/auth.js';
import { currentStage } from './stage.js';

// How long does a tool call take, start to finish, from this machine? Direct (the Function URL) and through the AgentCore Gateway
// (if the stage has one). Compared with the 500 ms limit Alexa+ gives a tool. Run: npm run bench:reply  (STAGE=roadmap by default off main)
const env: Record<string, string> = {};
const file = currentStage().envFile;
if (existsSync(file)) for (const l of readFileSync(file, 'utf8').split('\n')) { const [k, ...v] = l.split('='); if (k) env[k] = v.join('='); }
process.env.HG_TOKEN_SECRET = env.HG_TOKEN_SECRET;
const N = Number(process.env.BENCH_N ?? 30);
const args = { service: 'sim-home', action: 'light', item: 'lights', value: 'on' };
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
const post = async (url: string, bearer: string, body: unknown) => {
  const t = performance.now();
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${bearer}` }, body: JSON.stringify(body) });
  const text = await r.text();
  return { ms: performance.now() - t, status: r.status, text };
};
const call = (name: string, a: unknown, id: number) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: a } });
async function run(label: string, url: string, bearer: string, name: string) {
  await post(url, bearer, call(name, args, 0)); // one warm-up call (a cold start is a different, one-off cost)
  const ms: number[] = [];
  let bad = 0;
  for (let i = 1; i <= N; i++) {
    const r = await post(url, bearer, call(name, { ...args, request_id: `b${Date.now()}${i}` }, i));
    if (r.status !== 200 || r.text.includes('"isError":true')) bad++;
    ms.push(r.ms);
  }
  return { label, n: N, bad, p50: Math.round(pct(ms, 50)), p95: Math.round(pct(ms, 95)), max: Math.round(Math.max(...ms)) };
}
const rows = [];
rows.push(await run('direct (Function URL → /mcp)', `${env.HG_URL}/mcp`, mintToken('bench', 300, 'bench'), 'request_action'));
if (env.HG_GATEWAY_URL ?? process.env.HG_GATEWAY_URL) {
  const aws = (a: string[]) => JSON.parse(execFileSync('aws', [...a, '--region', 'us-east-1', '--output', 'json'], { encoding: 'utf8' }));
  const c = aws(['cognito-idp', 'describe-user-pool-client', '--user-pool-id', env.HG_POOL_ID, '--client-id', env.HG_SERVICE_CLIENT_ID]).UserPoolClient;
  const tok = (await (await fetch(`${env.HG_SIGN_IN_DOMAIN}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${c.ClientId}:${c.ClientSecret}`).toString('base64')}` }, body: 'grant_type=client_credentials&scope=hg%2Fmcp' })).json()) as { access_token: string };
  rows.push(await run('through the AgentCore Gateway', env.HG_GATEWAY_URL ?? process.env.HG_GATEWAY_URL!, tok.access_token, 'guard___request_action'));
}
const verdict = (r: { p95: number }) => (r.p95 <= 500 ? 'within 500 ms' : 'OVER 500 ms');
const out = ['| Path | Calls | Errors | p50 | p95 | Slowest | 500 ms limit (p95) |', '|---|---|---|---|---|---|---|', ...rows.map((r) => `| ${r.label} | ${r.n} | ${r.bad} | ${r.p50} ms | ${r.p95} ms | ${r.max} ms | ${verdict(r)} |`)].join('\n');
console.log(out);
writeFileSync('test-results/reply-time.md', out + '\n');
