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
const N = Number(process.env.BENCH_N ?? 100);
const args = { service: 'sim-home', action: 'light', item: 'lights', value: 'on' };
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
const post = async (url: string, bearer: string, body: unknown) => {
  const t = performance.now();
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${bearer}` }, body: JSON.stringify(body) });
  const text = await r.text();
  return { ms: performance.now() - t, status: r.status, text };
};
const call = (name: string, a: unknown, id: number) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: a } });
const aws = (a: string[]) => JSON.parse(execFileSync('aws', [...a, '--region', 'us-east-1', '--output', 'json'], { encoding: 'utf8' }));
const targets: { label: string; url: string; bearer: string; tool: string; ms: number[]; bad: number }[] = [
  { label: 'direct (Function URL → /mcp)', url: `${env.HG_URL}/mcp`, bearer: mintToken('bench', 300, 'bench'), tool: 'request_action', ms: [], bad: 0 },
];
if (env.HG_GATEWAY_URL && env.HG_GATEWAY_CLIENT_ID) {
  const c = aws(['cognito-idp', 'describe-user-pool-client', '--user-pool-id', env.HG_POOL_ID, '--client-id', env.HG_GATEWAY_CLIENT_ID]).UserPoolClient;
  const tok = (await (await fetch(`${env.HG_SIGN_IN_DOMAIN}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${c.ClientId}:${c.ClientSecret}`).toString('base64')}` }, body: 'grant_type=client_credentials&scope=hg%2Fmcp' })).json()) as { access_token: string };
  targets.push({ label: 'through the AgentCore Gateway', url: env.HG_GATEWAY_URL, bearer: tok.access_token, tool: 'guard___request_action', ms: [], bad: 0 });
}
for (const t of targets) await post(t.url, t.bearer, call(t.tool, args, 0)); // warm-up
// the two paths take turns, so network drift during the run counts the same against both
for (let i = 1; i <= N; i++) {
  for (const t of targets) {
    const r = await post(t.url, t.bearer, call(t.tool, { ...args, request_id: `b${Date.now()}${i}` }, i));
    if (r.status !== 200 || r.text.includes('"isError":true') || !/allowed/.test(r.text)) t.bad++; // a deny or a hold is not a success
    t.ms.push(r.ms);
  }
}
const rows = targets.map((t) => ({ label: t.label, n: N, bad: t.bad, p50: Math.round(pct(t.ms, 50)), p95: Math.round(pct(t.ms, 95)), max: Math.round(Math.max(...t.ms)) }));
const verdict = (r: { p95: number }) => (r.p95 <= 500 ? 'within 500 ms' : 'OVER 500 ms');
const out = [`Measured ${new Date().toISOString().slice(0, 16)}Z from a WSL2 machine over the internet, ${N} calls per path, warmed first, paths alternating. Both answer a low-risk lights request.`, '', '| Path | Calls | Errors | p50 | p95 | Slowest | 500 ms limit (p95) |', '|---|---|---|---|---|---|---|', ...rows.map((r) => `| ${r.label} | ${r.n} | ${r.bad} | ${r.p50} ms | ${r.p95} ms | ${r.max} ms | ${verdict(r)} |`)].join('\n');
console.log(out);
writeFileSync('test-results/reply-time.md', out + '\n');
