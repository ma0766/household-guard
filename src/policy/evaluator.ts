import { createHash } from 'node:crypto';
import * as cedar from '@cedar-policy/cedar-wasm/nodejs';
import type { Role, SessionMethod } from '../core/types.js';
import { generatePolicies, type RulesConfig } from './rules.js';

import { SCHEMA_TEXT } from './schema.js';
export const SCHEMA = SCHEMA_TEXT;

export interface DecisionInput {
  person: { id: string; role: Role };
  action: string;
  service: string;
  serviceKnown: boolean;
  amountCents: number;
  weekSpentCents: number;
  value: number;
  session: SessionMethod;
  localHour: number; // 0-23 in the house's own zone (S10). Required: a caller that forgets it must not skip quiet hours.
}
export type Answer = 'allow' | 'hold' | 'deny';
export interface PolicyDecision {
  answer: Answer;
  determining: string[]; // policy ids that decided it
  stage: 'auto' | 'approvable' | 'none';
  blockedBy: string[]; // the forbid rules that stopped "do it" (and sent the ask to an adult, or to no)
}

const uid = (type: string, id: string) => ({ type, id });

const callOf = (i: DecisionInput) => ({
  principal: uid('Person', i.person.id),
  action: uid('Action', i.action),
  resource: uid('Service', i.service),
  context: { service_known: i.serviceKnown, amount_cents: i.amountCents, week_spent_cents: i.weekSpentCents, value: i.value, session: i.session, local_hour: i.localHour },
  entities: [
    { uid: uid('Person', i.person.id), attrs: {}, parents: [uid('Role', i.person.role)] },
    { uid: uid('Role', i.person.role), attrs: {}, parents: [] },
    { uid: uid('Service', i.service), attrs: {}, parents: [] },
  ],
});

function ask(policies: Record<string, string>, i: DecisionInput) {
  const call = {
    principal: uid('Person', i.person.id),
    action: uid('Action', i.action),
    resource: uid('Service', i.service),
    context: { service_known: i.serviceKnown, amount_cents: i.amountCents, week_spent_cents: i.weekSpentCents, value: i.value, session: i.session, local_hour: i.localHour },
    policies: { staticPolicies: policies },
    entities: [
      { uid: uid('Person', i.person.id), attrs: {}, parents: [uid('Role', i.person.role)] },
      { uid: uid('Role', i.person.role), attrs: {}, parents: [] },
      { uid: uid('Service', i.service), attrs: {}, parents: [] },
    ],
  };
  const r = cedar.isAuthorized(call as any);
  // any engine failure or evaluation error is thrown → callers fail closed (hold)
  if (r.type !== 'success') throw new Error(`policy engine failed: ${JSON.stringify(r.errors)}`);
  if (r.response.diagnostics.errors.length) throw new Error('policy evaluation error');
  return { allowed: r.response.decision === 'allow', ids: r.response.diagnostics.reason as string[] };
}

// Many questions against the same rules (try it first replays a week of requests): parse the rules ONCE, then ask. About ten times faster
// than parsing them for every question. Same engine, same answers; a failure throws, so callers fail closed.
export interface PreparedSets { ids?: { auto: string; approvable: string }; raw: { auto: Record<string, string>; approvable: Record<string, string> } }
const parsed = new Set<string>();
function prepare(policies: Record<string, string>): string | undefined {
  const id = `ps-${createHash('sha256').update(JSON.stringify(Object.entries(policies).sort())).digest('hex').slice(0, 24)}`;
  if (parsed.has(id)) return id;
  if (parsed.size >= 64) return undefined; // the engine keeps what it parsed: stop at a bound (a warm server that has seen many rule sets then just asks the slow way)
  const r = cedar.preparsePolicySet(id, { staticPolicies: policies } as any);
  if (r.type !== 'success') return undefined;
  parsed.add(id);
  return id;
}
export function prepareSets(sets: { auto: Record<string, string>; approvable: Record<string, string> }): PreparedSets {
  const auto = prepare(sets.auto);
  const approvable = prepare(sets.approvable);
  return { ...(auto && approvable ? { ids: { auto, approvable } } : {}), raw: sets };
}
function askPrepared(id: string, i: DecisionInput) {
  const r = cedar.statefulIsAuthorized({ ...callOf(i), preparsedPolicySetId: id } as any);
  if (r.type !== 'success') throw new Error('policy engine failed');
  if (r.response.diagnostics.errors.length) throw new Error('policy evaluation error');
  return { allowed: r.response.decision === 'allow', ids: r.response.diagnostics.reason as string[] };
}
export function decidePrepared(p: PreparedSets, i: DecisionInput): PolicyDecision {
  if (!p.ids) return decideWith(p.raw, i);
  const a = askPrepared(p.ids.auto, i);
  if (a.allowed) return { answer: 'allow', determining: a.ids, stage: 'auto', blockedBy: [] };
  const b = askPrepared(p.ids.approvable, i);
  if (b.allowed) return { answer: 'hold', determining: b.ids, stage: 'approvable', blockedBy: a.ids };
  return { answer: 'deny', determining: b.ids, stage: b.ids.length ? 'approvable' : 'none', blockedBy: [...new Set([...a.ids, ...b.ids])] };
}

export function decide(config: RulesConfig, i: DecisionInput): PolicyDecision {
  return decideWith(generatePolicies(config), i);
}

// The same three answers from ready-made rule sets (tests use this to show that a stray extra permit cannot loosen a forbid).
export function decideWith(sets: { auto: Record<string, string>; approvable: Record<string, string> }, i: DecisionInput): PolicyDecision {
  const a = ask(sets.auto, i);
  if (a.allowed) return { answer: 'allow', determining: a.ids, stage: 'auto', blockedBy: [] };
  const b = ask(sets.approvable, i);
  if (b.allowed) return { answer: 'hold', determining: b.ids, stage: 'approvable', blockedBy: a.ids };
  return { answer: 'deny', determining: b.ids, stage: b.ids.length ? 'approvable' : 'none', blockedBy: [...new Set([...a.ids, ...b.ids])] };
}

// Checked before any rule set goes live: bad rules never get saved.
export function validateRules(config: RulesConfig): { ok: boolean; errors: string[] } {
  const sets = generatePolicies(config);
  const errors: string[] = [];
  for (const [name, set] of Object.entries(sets)) {
    const r = cedar.validate({ validationSettings: { mode: 'strict' }, schema: SCHEMA, policies: { staticPolicies: set } } as any);
    if (r.type === 'failure') errors.push(`${name}: ${r.errors.map((e) => e.message).join('; ')}`);
    else for (const e of r.validationErrors) errors.push(`${name}: ${e.error.message}`);
  }
  return { ok: errors.length === 0, errors };
}
