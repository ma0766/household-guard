import type { Role } from '../core/types.js';

// The rule card data. Nobody types Cedar: policies are generated from this and validated before use.
export interface RulesConfig {
  version: number;
  weeklyCapCents: Record<string, number>; // personId → cap (no entry = no automatic buying)
  perRequestCapCents: Record<string, number>;
  adultsOnlyActions: string[]; // device class: locks and garage
  allowedServices: string[]; // service allowlist; anything else needs approval
  floor: { childrenNoUnlock: boolean; guestsNoBuy: boolean }; // locked by default (S7)
  needsApproval: { role: Role; action: string }[];
  deny: { role: Role; action: string }[];
  mustHaves: { arriveByHour?: number; bagIncluded?: boolean };
  quietHours?: { fromHour: number; toHour: number }; // no buying for non-adults, in the house's own time zone (S10)
  orderRoles?: Role[]; // S19: who besides adults may hear order history, delivery news and the cart. Missing = adults only. Gifts are never read to non-adults, whatever this says.
}

export const ORDER_ACTIONS = ['order_history', 'order_status', 'cart'] as const;

export const KNOWN_ACTIONS = ['light', 'thermostat', 'unlock', 'garage', 'purchase', 'use_app', 'build_site'] as const;
export const ROLES: Role[] = ['adult', 'teen', 'child', 'guest'];

export function defaultRules(): RulesConfig {
  return {
    version: 1,
    weeklyCapCents: { mom: 50000, maya: 2000 },
    perRequestCapCents: { mom: 20000, maya: 2000 },
    adultsOnlyActions: ['unlock', 'garage'],
    allowedServices: ['sim-home', 'mock-ride', 'mock-shop'],
    floor: { childrenNoUnlock: true, guestsNoBuy: true },
    needsApproval: [],
    deny: [],
    mustHaves: {},
  };
}

export interface PolicySets {
  auto: Record<string, string>;
  approvable: Record<string, string>;
}

const q = (s: string) => JSON.stringify(s);

// Three answers from a yes/no engine: ask `auto` first (do it), then `approvable` (hold for an adult), else deny.
// `forbid` rules go in BOTH sets so no permit can ever outrank them.
export function generatePolicies(c: RulesConfig): PolicySets {
  const auto: Record<string, string> = {};
  const approvable: Record<string, string> = {};
  const both = (id: string, text: string) => {
    auto[id] = text;
    approvable[id] = text;
  };

  // low risk: anyone, known service
  auto.light = `permit(principal, action == Action::"light", resource) when { context.service_known };`;
  auto.thermostat = `permit(principal, action == Action::"thermostat", resource) when { context.service_known && context.value >= 60 && context.value <= 78 };`;

  // a connected app (S13): anyone signed in may use an app the house has allowed; guests never
  auto.use_app = `permit(principal, action == Action::"use_app", resource) when { context.service_known } unless { principal in Role::"guest" };`;

  // building and publishing a site: an adult with her own phone tap. Everyone else is held for an adult.
  auto.build_site = `permit(principal in Role::"adult", action == Action::"build_site", resource) when { context.session == "phone" };`; // the site builder is the house's own tool: no allowed-app list applies

  // device class: adults only
  for (const a of c.adultsOnlyActions) {
    both(`adults_only_${a}`, `forbid(principal, action == Action::${q(a)}, resource) unless { principal in Role::"adult" };`);
    auto[`adult_${a}`] = `permit(principal in Role::"adult", action == Action::${q(a)}, resource) when { context.service_known && context.session == "phone" };`;
  }

  // spend caps: per person, per request and per week
  for (const [id, week] of Object.entries(c.weeklyCapCents)) {
    const per = c.perRequestCapCents[id] ?? week;
    auto[`cap_${id}`] = `permit(principal == Person::${q(id)}, action == Action::"purchase", resource) when { context.service_known && context.amount_cents <= ${per} && context.week_spent_cents + context.amount_cents <= ${week} };`;
  }

  // private orders (S19): who may hear order history, delivery status and the cart. Adults always; others only if a card says so.
  const readers = [...new Set(['adult', ...(c.orderRoles ?? [])])];
  readers.forEach((r) => (auto[`orders_${r}`] = `permit(principal in Role::${q(r)}, action in [Action::"order_history", Action::"order_status", Action::"cart"], resource) when { context.service_known };`));
  // a gift is never read aloud or shown to a child, a teen or a guest. A forbid in BOTH sets, and no card can switch it off.
  auto.gifts_adults = `permit(principal in Role::"adult", action == Action::"order_gift", resource) when { context.service_known };`;
  both('gifts_private', `forbid(principal, action == Action::"order_gift", resource) unless { principal in Role::"adult" };`);

  // locked floor
  if (c.floor.guestsNoBuy) both('floor_guests_no_buy', `forbid(principal in Role::"guest", action == Action::"purchase", resource);`);
  if (c.floor.childrenNoUnlock) both('floor_children_no_unlock', `forbid(principal in Role::"child", action == Action::"unlock", resource);`);

  // quiet hours: a forbid in BOTH sets, so no permit and no adult approval can override it. Adults are not held to it.
  if (c.quietHours) {
    const { fromHour: f, toHour: t } = c.quietHours;
    const inside = f > t ? `context.local_hour >= ${f} || context.local_hour < ${t}` : `context.local_hour >= ${f} && context.local_hour < ${t}`;
    both('quiet_hours', `forbid(principal, action == Action::"purchase", resource) when { ${inside} } unless { principal in Role::"adult" };`);
  }

  // explicit rule types
  c.deny.forEach((r, i) => both(`deny_${i}`, `forbid(principal in Role::${q(r.role)}, action == Action::${q(r.action)}, resource);`));
  c.needsApproval.forEach((r, i) => (auto[`needs_approval_${i}`] = `forbid(principal in Role::${q(r.role)}, action == Action::${q(r.action)}, resource);`));

  // anything a known person may ask for, but wasn't automatic, can be held for an adult. Unknown action → no permit → deny.
  approvable.hold_known = `permit(principal, action, resource) when { !(principal in Role::"guest") && [Action::"light", Action::"thermostat", Action::"unlock", Action::"garage", Action::"purchase", Action::"use_app", Action::"build_site"].contains(action) };`;
  return { auto, approvable };
}
