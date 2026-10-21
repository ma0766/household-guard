// Replays the 30 replay cases over HTTP against the deployed prod URL (fresh household per case).
// Token is minted from .env.deploy in memory; never printed. Run: npx tsx audit/2026-10-21/replay-prod.ts
import { readFileSync } from 'node:fs';
import { mintToken } from '../../src/auth.js';
import { CASES } from '../../tests/replay/cases.js';

const env: Record<string, string> = {};
for (const l of readFileSync('.env.deploy', 'utf8').split('\n')) { const [k, ...v] = l.split('='); if (k) env[k] = v.join('='); }
process.env.HG_TOKEN_SECRET = env.HG_TOKEN_SECRET;
const base = env.HG_URL;

async function run(hh: string) {
  const token = mintToken('audit', 900, hh);
  let id = 1;
  const tool = async (name: string, args: Record<string, unknown>) => {
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } }) });
    const j: any = await r.json();
    return j.result?.structuredContent ?? { http: r.status, raw: j };
  };
  const tap = async (person: string, challenge_id: string, number: number) => {
    const r = await fetch(`${base}/phone/${person}/confirm`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${mintToken(person, 900, hh, 'phone')}` }, body: JSON.stringify({ challenge_id, number }) });
    return (await r.json()) as any;
  };
  const speak = async (who: string, method: string) => {
    if (who === 'guest') { await fetch(`${base}/demo/guest`, { method: 'POST', headers: { authorization: `Bearer ${mintToken('audit', 900, hh)}` } }); return; }
    if (method === 'pin') {
      const r = await tool('confirm_identity', { name: who, pin: who === 'leo' ? '4821' : '0000' });
      if (r.status !== 'confirmed') throw new Error(`pin login failed ${JSON.stringify(r)}`);
      return;
    }
    const c = await tool('confirm_identity', { name: who });
    const t = await tap(who, c.challenge_id, c.number);
    if (t.status !== 'confirmed') throw new Error(`phone login failed ${JSON.stringify(t)}`);
  };
  return { tool, tap, speak };
}

// rule edits an adult can make with the public tools; others have no tool
const RULE: Record<string, Record<string, unknown>> = {
  'limit-raised-teen-airport-38-still-held': { template: 'weekly_limit', person: 'maya', dollars: 30 },
  'limit-raised-teen-airport-economy-24-allowed': { template: 'weekly_limit', person: 'maya', dollars: 30 },
  'limit-lowered-teen-mall-15-held': { template: 'weekly_limit', person: 'maya', dollars: 10 },
  'adults-only-thermostat-teen-denied': { template: 'adults_only', actions: ['garage', 'thermostat', 'unlock'] },
  'apps-without-shop-teen-gift-card-held': { template: 'allowed_apps', services: ['mock-ride', 'sim-home'] },
  'guest-buy-floor-off-still-denied': { template: 'floor', which: 'guestsNoBuy', enabled: false },
  'child-unlock-floor-off-still-denied': { template: 'floor', which: 'childrenNoUnlock', enabled: false },
  'must-have-bag-teen-airport-held': { template: 'must_haves', bag_included: true },
};

const rows: string[] = [];
let pass = 0, fail = 0, na = 0;
for (const c of CASES) {
  const hh = `audit${Date.now()}${Math.floor(Math.random() * 1e5)}`;
  try {
    if (c.who === 'mom' && c.method === 'pin') { na++; rows.push(`NOT-REPLICABLE | ${c.id} | Mom has no PIN in the seeded household; no public way to set one`); continue; }
    if (c.rules && !RULE[c.id]) { na++; rows.push(`NOT-REPLICABLE | ${c.id} | no public tool makes this rule (needsApproval/deny lists)`); continue; }
    const s = await run(hh);
    if (c.rules) {
      await s.speak('mom', 'phone');
      const r: any = await s.tool('set_rule', RULE[c.id]);
      if (r.status !== 'waiting') throw new Error(`set_rule ${JSON.stringify(r)}`);
      let t = await s.tap('mom', r.challenge_id, r.number);
      if (t.result && !t.result.done && t.result.jobId) t = await s.tap('mom', t.result.jobId, Number(String(t.say).match(/(\d\d)\s*$/)![1]));
      if (!(t.result?.done) && c.id.includes('floor')) throw new Error(`floor 2-step not completed: ${JSON.stringify(t)}`);
    }
    await s.speak(c.who, c.method ?? 'phone');
    const r = await s.tool('request_action', { ...c.args });
    const okOutcome = r.outcome === c.expect.outcome;
    const okDone = c.expect.done === undefined || r.done === c.expect.done;
    if (okOutcome && okDone) { pass++; rows.push(`PASS | ${c.id} | ${r.outcome} done=${r.done}`); }
    else { fail++; rows.push(`FAIL | ${c.id} | expected ${c.expect.outcome}${c.expect.done !== undefined ? ' done=' + c.expect.done : ''} got ${r.outcome} done=${r.done} say=${r.say ?? JSON.stringify(r).slice(0, 150)}`); }
  } catch (e: any) { fail++; rows.push(`ERROR | ${c.id} | ${String(e.message).slice(0, 200)}`); }
}
console.log(rows.join('\n'));
console.log(`PROD REPLAY: ${pass} pass, ${fail} fail/error, ${na} not replicable over HTTP, of ${CASES.length}`);
