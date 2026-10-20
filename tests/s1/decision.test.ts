import { describe, expect, it } from 'vitest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { newHousehold, speakAs } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';
import { Store } from '../../src/core/store.js';
import { readHome } from '../../src/connectors/sim-home.js';
import { decide, validateRules } from '../../src/policy/evaluator.js';
import { defaultRules, generatePolicies } from '../../src/policy/rules.js';
import { weekKey, localDate } from '../../src/core/time.js';
import { BANNED_WORDS, T } from '../../src/text.js';

const home = (action: string, item?: string, value?: string | number) => ({ service: 'sim-home', action, item, value });

describe('S1 first decision: lights', () => {
  it('teen "turn off the lights" → done, and the home really changed', async () => {
    const { hh, store, deps } = await newHousehold();
    await speakAs(store, hh, 'maya');
    const r = await requestAction(deps, hh, home('light', 'lights', 'off'));
    expect(r).toMatchObject({ outcome: 'allowed', done: true });
    expect(r.say).toBe('Done. The lights are off.');
    expect(await readHome(store, hh)).toContainEqual({ device: 'lights', state: 'off' });
  });

  it('teen "unlock the front door" → denied with a reason, door untouched', async () => {
    const { hh, store, deps } = await newHousehold();
    await speakAs(store, hh, 'maya');
    const r = await requestAction(deps, hh, home('unlock', 'front door'));
    expect(r).toMatchObject({ outcome: 'denied', done: false, reason: 'Only adults can do that.' });
    expect(await readHome(store, hh)).toEqual([]);
  });

  it('unknown "delete account" → denied with no rule written for it', async () => {
    const { hh, store, deps } = await newHousehold();
    await speakAs(store, hh, 'mom');
    const r = await requestAction(deps, hh, { service: 'sim-home', action: 'delete_account' });
    expect(r.outcome).toBe('denied');
  });

  it('unknown service → needs approval (held)', async () => {
    const { hh, store, deps } = await newHousehold();
    await speakAs(store, hh, 'mom');
    expect((await requestAction(deps, hh, { service: 'new-app', action: 'light', value: 'on' })).outcome).toBe('held');
  });

  it('no confirmed session → guest, even if the caller claims to be Mom', async () => {
    const { hh, deps } = await newHousehold();
    const r = await requestAction(deps, hh, { ...home('unlock', 'front door'), person: 'mom', speaker: 'mom' } as any);
    expect(r).toMatchObject({ outcome: 'denied', person: 'guest' });
  });

  it('forbid beats permit: even an adult-only rule written wrong cannot be outranked', () => {
    const c = defaultRules();
    const base = { service: 'sim-home', serviceKnown: true, amountCents: 0, weekSpentCents: 0, value: 0, session: 'phone' as const };
    expect(decide(c, { ...base, person: { id: 'maya', role: 'teen' }, action: 'unlock' }).answer).toBe('deny');
    expect(decide(c, { ...base, person: { id: 'mom', role: 'adult' }, action: 'unlock' }).answer).toBe('allow');
  });

  it('generated rules pass schema validation', () => {
    expect(validateRules(defaultRules())).toEqual({ ok: true, errors: [] });
    expect(Object.keys(generatePolicies(defaultRules()).auto).length).toBeGreaterThan(3);
  });
});

describe('S1 fail closed (gap 7)', () => {
  it('a DynamoDB error gives hold, never allowed', async () => {
    const { hh, store } = await newHousehold();
    await speakAs(store, hh, 'mom');
    const broken = new DynamoDBClient({ endpoint: 'http://127.0.0.1:1', region: 'us-east-1', credentials: { accessKeyId: 'x', secretAccessKey: 'x' }, maxAttempts: 1 });
    const r = await requestAction({ store: new Store(broken) }, hh, home('light', 'lights', 'off'));
    expect(r.outcome).toBe('held');
    expect(r.done).toBe(false);
  });

  it('a rule engine error gives hold, never allowed', async () => {
    const { hh, store, deps } = await newHousehold();
    await speakAs(store, hh, 'mom');
    // corrupt rules: a cap that is not a number makes the generated rule unparseable
    await store.put({ pk: Store.hk(hh), sk: 'RULES#current', config: { ...defaultRules(), weeklyCapCents: { mom: 'x' } } });
    const r = await requestAction(deps, hh, home('light', 'lights', 'off'));
    expect(r.outcome).toBe('held');
  });
});

describe('S1 household time zone (gap 13)', () => {
  it('is stored with the household and used for timestamps and weeks', async () => {
    const { hh, store, deps } = await newHousehold();
    expect((await store.get(Store.hk(hh), 'META'))?.timezone).toBe('America/New_York');
    const r = await requestAction(deps, hh, home('light', 'lights', 'on'));
    expect(r.at_local).toMatch(/\d/);
  });
  it('week and day follow the household zone, not UTC', () => {
    // Mon 2026-10-19 02:00 UTC is still Sunday 22:00 in New York → belongs to the week of Mon 10-12
    const ts = Date.parse('2026-10-19T02:00:00Z');
    expect(localDate(ts, 'America/New_York')).toBe('2026-10-18');
    expect(weekKey(ts, 'America/New_York')).toBe('2026-10-12');
    expect(weekKey(ts, 'UTC')).toBe('2026-10-19');
  });
});

describe('S1 tool shape and words', () => {
  it('request_action has no person or speaker argument', async () => {
    const { buildMcpServer } = await import('../../src/mcp/server.js');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const { deps } = await newHousehold();
    const server = buildMcpServer(deps, 'x');
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: 't', version: '1' });
    await client.connect(b);
    const tool = (await client.listTools()).tools.find((t) => t.name === 'request_action')!;
    const props = Object.keys((tool.inputSchema as any).properties);
    for (const bad of ['person', 'speaker', 'user', 'who', 'name', 'principal', 'identity']) expect(props).not.toContain(bad);
  });

  it('user-facing text has no tech words and short sentences', () => {
    const samples: string[] = [];
    for (const v of Object.values(T)) {
      if (typeof v === 'string') samples.push(v);
      else if (v.length === 1) samples.push((v as any)(47) ?? '', (v as any)('Maya') ?? '');
    }
    samples.push(T.done('light', 'lights', 'off'), T.done('unlock', 'front door'), T.done('garage'), T.done('thermostat', undefined, 72), T.overWeekly('Maya', 2000), T.overOneBuy('Maya', 1500));
    for (const s of samples.filter(Boolean)) {
      for (const sentence of s.split(/(?<=[.!?])\s+/)) expect(sentence.split(/\s+/).length, sentence).toBeLessThan(12);
      for (const w of BANNED_WORDS) expect(s.toLowerCase(), s).not.toMatch(new RegExp(`\\b${w}\\b`));
    }
  });
});

describe('S1 policy files', () => {
  it('the committed auto.cedar / approvable.cedar match the generated defaults (run npx tsx scripts/gen-policies.ts)', async () => {
    const { readFileSync } = await import('node:fs');
    const render = (set: Record<string, string>) => Object.entries(set).map(([id, t]) => `@id(${JSON.stringify(id)})\n${t}`).join('\n\n') + '\n';
    const sets = generatePolicies(defaultRules());
    expect(readFileSync('src/policy/auto.cedar', 'utf8')).toBe(render(sets.auto));
    expect(readFileSync('src/policy/approvable.cedar', 'utf8')).toBe(render(sets.approvable));
  });
  it('an explicit deny rule says "I can\'t do that", not "only adults"', async () => {
    const { hh, store, deps } = await newHousehold();
    await speakAs(store, hh, 'maya');
    await store.put({ pk: Store.hk(hh), sk: 'RULES#current', config: { ...defaultRules(), deny: [{ role: 'teen', action: 'light' }] } });
    const r = await requestAction(deps, hh, home('light', 'lights', 'on'));
    expect(r).toMatchObject({ outcome: 'denied', reason: "I can't do that." });
  });
  it('a needs-approval rule holds instead of doing it', async () => {
    const { hh, store, deps } = await newHousehold();
    await speakAs(store, hh, 'maya');
    await store.put({ pk: Store.hk(hh), sk: 'RULES#current', config: { ...defaultRules(), needsApproval: [{ role: 'teen', action: 'light' }] } });
    expect((await requestAction(deps, hh, home('light', 'lights', 'on'))).outcome).toBe('held');
  });
  it('all four roles exist in the table', async () => {
    const { hh, store } = await newHousehold();
    const people = await store.query(Store.hk(hh), 'PERSON#');
    expect(people.map((p) => p.role).sort()).toEqual(['adult', 'child', 'guest', 'teen']);
  });
});
