import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { CASES } from '../replay/cases.js';
import { newHousehold, speakAs } from '../helpers.js';
import { Store } from '../../src/core/store.js';
import { defaultRules } from '../../src/policy/rules.js';
import { handleGatewayCall, gatewayEnabled, TOOL_SCHEMA } from '../../src/gateway/handler.js';
import { requestAction } from '../../src/core/request-action.js';

// S16: the AgentCore Gateway is a second front door to the SAME decision. Off unless a stage switches it on.
describe('S16 the same 30 replay cases give the same answers through the gateway', () => {
  for (const c of CASES) {
    it(`${c.id}`, async () => {
      const direct = await newHousehold();
      const via = await newHousehold();
      for (const k of [direct, via]) {
        if (c.rules) await k.store.put({ pk: Store.hk(k.hh), sk: 'RULES#current', config: { ...defaultRules(), ...c.rules } });
        await speakAs(k.store, k.hh, c.who, c.method ?? 'phone');
      }
      const a = await requestAction(direct.deps, direct.hh, c.args);
      const b = await handleGatewayCall(via.deps, via.hh, 'guard___request_action', c.args);
      expect(b.outcome).toBe(c.expect.outcome);
      expect(b.outcome).toBe(a.outcome);
      expect(b.done).toBe(a.done);
      if (c.expect.done !== undefined) expect(b.done).toBe(c.expect.done);
    });
  }
});

describe('S16 the gateway door has no person field', () => {
  it('the published tool shape has no person, speaker or user', () => {
    expect(JSON.stringify(TOOL_SCHEMA)).not.toMatch(/person|speaker|user|who/i);
  });
  it('a call carrying a person (or anything unknown) is refused and nothing runs', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya');
    for (const extra of [{ person: 'mom' }, { speaker: 'mom' }, { user: 'mom' }, { as: 'mom' }, { household: 'other' }, { __proto__: { x: 1 }, 'person ': 'mom' }]) {
      const r = await handleGatewayCall(ctx.deps, ctx.hh, 'guard___request_action', { service: 'sim-home', action: 'unlock', item: 'front door', ...extra });
      expect(r.outcome).toBe('denied');
    }
    expect((await ctx.store.query(Store.hk(ctx.hh), 'DEVICE#')).length).toBe(0);
  });
  it('another tool name, a non-object, wrong types and long strings are refused', async () => {
    const ctx = await newHousehold();
    for (const [tool, input] of [['guard___delete_everything', { service: 'x', action: 'y' }], ['guard___request_action', 'light'], ['guard___request_action', null], ['guard___request_action', [1]], ['guard___request_action', { service: 5, action: 'light' }], ['guard___request_action', { service: 'a'.repeat(200), action: 'light' }], ['guard___request_action', { service: 'sim-home', action: 'light', item: { nested: true } }]] as const) {
      expect((await handleGatewayCall(ctx.deps, ctx.hh, tool, input)).outcome, `${tool} ${JSON.stringify(input)?.slice(0, 40)}`).toBe('denied');
    }
  });
  it('an error inside is a hold, never an allow', async () => {
    const ctx = await newHousehold();
    const broken = { ...ctx.deps, store: new Proxy(ctx.deps.store, { get: (t, k) => (k === 'get' || k === 'query' ? async () => { throw new Error('db down'); } : (t as any)[k]) }) } as typeof ctx.deps;
    const r = await handleGatewayCall(broken, ctx.hh, 'guard___request_action', { service: 'sim-home', action: 'light', item: 'lights', value: 'on' });
    expect(r.outcome).not.toBe('allowed');
    expect(r.done).toBe(false);
  });
});

describe('S16 the schema published by the infrastructure equals the one in code', () => {
  it('same tool shape (no person field) in infra/app.ts and src/gateway/handler.ts', () => {
    const infra = readFileSync('infra/app.ts', 'utf8');
    const block = /const GATEWAY_TOOL_SCHEMA = (\[[\s\S]*?\n\]);/.exec(infra)![1];
    expect(new Function(`return ${block}`)()).toEqual(TOOL_SCHEMA);
  });
});

describe('S16 the switch is off by default', () => {
  it('is on only when a stage says so', () => {
    expect(gatewayEnabled({})).toBe(false);
    expect(gatewayEnabled({ HG_GATEWAY: '1' })).toBe(false);
    expect(gatewayEnabled({ HG_GATEWAY: 'agentcore' })).toBe(true);
  });
  const synth = (ctx: string[]) => {
    execFileSync('npx', ['cdk', 'synth', 'HouseholdGuard-roadmap', '-q', '--no-staging', '-o', 'dist/cdk-test', '-c', 'stage=roadmap', ...ctx.flatMap((c) => ['-c', c])], { env: { ...process.env, HG_TOKEN_SECRET: 'synth-only', CDK_DEFAULT_ACCOUNT: '123456789012' }, stdio: 'pipe' });
    const t = JSON.parse(readFileSync('dist/cdk-test/HouseholdGuard-roadmap.template.json', 'utf8'));
    return Object.values(t.Resources as Record<string, any>);
  };
  const types = (rs: any[]) => rs.map((r) => r.Type as string);
  it('a normal build has no gateway at all', () => {
    expect(types(synth([])).filter((t) => t.includes('BedrockAgentCore'))).toEqual([]);
  }, 120000);
  it('with the switch: a gateway, one tool target, a policy engine and a policy in LOG-ONLY mode', () => {
    const rs = synth(['agentcore=1']);
    const t = types(rs);
    for (const x of ['AWS::BedrockAgentCore::Gateway', 'AWS::BedrockAgentCore::GatewayTarget', 'AWS::BedrockAgentCore::PolicyEngine', 'AWS::BedrockAgentCore::Policy']) expect(t).toContain(x);
    expect(rs.find((r) => r.Type === 'AWS::BedrockAgentCore::Policy').Properties.EnforcementMode).toBe('LOG_ONLY');
  }, 120000);
  it('and ENFORCE only when asked for twice', () => {
    expect(synth(['agentcore=1', 'agentcoreEnforce=1']).find((r) => r.Type === 'AWS::BedrockAgentCore::Policy').Properties.EnforcementMode).toBe('ENFORCE');
  }, 120000);
});
