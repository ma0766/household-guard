import type { Person } from '../core/types.js';
import { KNOWN_ACTIONS, type RulesConfig } from '../policy/rules.js';
import { validateRules } from '../policy/evaluator.js';
import { money } from '../text.js';

// Four rule cards (plus the locked floor). Nobody types Cedar: a card turns into a config, the config turns into
// Cedar, and the Cedar is checked against the schema BEFORE anything is saved.
export type RuleChange =
  | { template: 'weekly_limit'; person: string; cents: number }
  | { template: 'adults_only'; actions: string[] }
  | { template: 'allowed_apps'; services: string[] }
  | { template: 'must_haves'; bagIncluded?: boolean; arriveByHour?: number | null }
  | { template: 'floor'; which: 'childrenNoUnlock' | 'guestsNoBuy'; enabled: boolean };

export const MAX_CENTS = 1_000_000; // $10,000 — a typo guard, not a policy

export function isFloorLoosening(c: RuleChange): boolean {
  return c.template === 'floor' && c.enabled === false;
}

export type Applied = { ok: true; config: RulesConfig; sentence: string; warning?: string } | { ok: false; error: string };

export function applyChange(before: RulesConfig, change: RuleChange, people: Person[]): Applied {
  const next: RulesConfig = JSON.parse(JSON.stringify(before));
  next.version = before.version + 1;
  let sentence: string;
  let warning: string | undefined;
  switch (change.template) {
    case 'weekly_limit': {
      const p = people.find((x) => x.id === change.person && x.role !== 'guest');
      if (!p) return { ok: false, error: "I don't know that person." };
      if (!Number.isInteger(change.cents) || change.cents < 0 || change.cents > MAX_CENTS) return { ok: false, error: 'That limit does not look right.' };
      const old = before.weeklyCapCents[p.id];
      next.weeklyCapCents[p.id] = change.cents;
      next.perRequestCapCents[p.id] = change.cents;
      sentence = old === undefined ? `${p.name}'s limit is now ${money(change.cents)} a week.` : `${p.name}'s limit goes from ${money(old)} to ${money(change.cents)} a week.`;
      if (old !== undefined && change.cents > old) warning = `This lets ${p.name} spend ${money(change.cents - old)} more a week.`;
      break;
    }
    case 'adults_only': {
      const ok = change.actions.every((a) => (KNOWN_ACTIONS as readonly string[]).includes(a) && a !== 'purchase');
      if (!Array.isArray(change.actions) || !ok) return { ok: false, error: 'I can only lock down doors, the garage, the heat and lights.' };
      next.adultsOnlyActions = [...new Set(change.actions)].sort();
      sentence = next.adultsOnlyActions.length ? `Only adults can use: ${next.adultsOnlyActions.join(', ')}.` : 'No devices are adults-only now.';
      if (before.adultsOnlyActions.some((a) => !next.adultsOnlyActions.includes(a))) warning = 'This lets kids use a device that was adults-only.';
      break;
    }
    case 'allowed_apps': {
      if (!Array.isArray(change.services) || change.services.some((s) => typeof s !== 'string' || !/^[a-z0-9-]{1,40}$/.test(s))) return { ok: false, error: 'That app name does not look right.' };
      next.allowedServices = [...new Set(change.services)].sort();
      sentence = `Allowed apps: ${next.allowedServices.join(', ') || 'none'}.`;
      break;
    }
    case 'must_haves': {
      const h = change.arriveByHour;
      if (h !== undefined && h !== null && (!Number.isInteger(h) || h < 0 || h > 23)) return { ok: false, error: 'That hour does not look right.' };
      next.mustHaves = { ...(change.bagIncluded !== undefined ? { bagIncluded: change.bagIncluded } : before.mustHaves.bagIncluded !== undefined ? { bagIncluded: before.mustHaves.bagIncluded } : {}), ...(h === undefined ? (before.mustHaves.arriveByHour !== undefined ? { arriveByHour: before.mustHaves.arriveByHour } : {}) : h === null ? {} : { arriveByHour: h }) };
      sentence = `Best value must have: ${[next.mustHaves.bagIncluded ? 'a bag' : '', next.mustHaves.arriveByHour !== undefined ? `arrive by ${next.mustHaves.arriveByHour}:00` : ''].filter(Boolean).join(' and ') || 'nothing special'}.`;
      break;
    }
    case 'floor': {
      if (change.which !== 'childrenNoUnlock' && change.which !== 'guestsNoBuy') return { ok: false, error: "I don't know that rule." };
      next.floor[change.which] = !!change.enabled;
      const label = change.which === 'childrenNoUnlock' ? "children can't unlock doors" : "guests can't buy";
      sentence = change.enabled ? `Rule on: ${label}.` : `Rule off: ${label}.`;
      if (!change.enabled) warning = change.which === 'childrenNoUnlock' ? 'This lets a child unlock the front door.' : 'This lets a guest buy things.';
      break;
    }
    default:
      return { ok: false, error: "I don't know that rule." };
  }
  const v = validateRules(next); // the generated Cedar must pass the schema, or nothing is saved
  if (!v.ok) return { ok: false, error: 'That rule does not work.' };
  return { ok: true, config: next, sentence, warning };
}
