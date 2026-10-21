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
}
export type Answer = 'allow' | 'hold' | 'deny';
export interface PolicyDecision {
  answer: Answer;
  determining: string[]; // policy ids that decided it
  stage: 'auto' | 'approvable' | 'none';
}

const uid = (type: string, id: string) => ({ type, id });

function ask(policies: Record<string, string>, i: DecisionInput) {
  const call = {
    principal: uid('Person', i.person.id),
    action: uid('Action', i.action),
    resource: uid('Service', i.service),
    context: { service_known: i.serviceKnown, amount_cents: i.amountCents, week_spent_cents: i.weekSpentCents, value: i.value, session: i.session },
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

export function decide(config: RulesConfig, i: DecisionInput): PolicyDecision {
  const sets = generatePolicies(config);
  const a = ask(sets.auto, i);
  if (a.allowed) return { answer: 'allow', determining: a.ids, stage: 'auto' };
  const b = ask(sets.approvable, i);
  if (b.allowed) return { answer: 'hold', determining: b.ids, stage: 'approvable' };
  return { answer: 'deny', determining: b.ids, stage: b.ids.length ? 'approvable' : 'none' };
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
