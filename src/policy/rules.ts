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
  guestEveryday?: boolean; // "Everyday things for anyone at home" (default on). Off = anyone not confirmed (PIN or phone tap) can do nothing.
  guests?: NamedGuest[]; // named guests: a PIN of their own, their own allowed list, an end date
  noTapBuyCents?: Record<string, number>; // per person: small buys up to this amount skip the phone tap (off by default)
  orderRoles?: Role[]; // S19: who besides adults may hear order history, delivery news and the cart. Missing = adults only. Gifts are never read to non-adults, whatever this says.
}

export interface NamedGuest {
  id: string; // g-sam
  name: string;
  allowed: string[]; // everyday actions only
  untilMs: number; // after this instant the guest is switched off
}
export const EVERYDAY_ACTIONS = ['light', 'thermostat', 'music', 'weather', 'timer'] as const;

export const ORDER_ACTIONS = ['order_history', 'order_status', 'cart', 'mark_gift'] as const;

export const KNOWN_ACTIONS = ['light', 'thermostat', 'music', 'weather', 'timer', 'unlock', 'garage', 'purchase', 'use_app', 'build_site'] as const;
export const ROLES: Role[] = ['adult', 'teen', 'child', 'guest'];

export function defaultRules(): RulesConfig {
  return {
    version: 1,
    weeklyCapCents: { mom: 50000, maya: 2000 },
    perRequestCapCents: { mom: 20000, maya: 2000 },
    adultsOnlyActions: ['unlock'], // the garage is open to adults and teens (a spoken heads-up, no tap); children and guests never
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

  // RESTRICTIONS ARE FORBIDS. A permit only says what an action is; every limit below is a forbid, and a forbid always beats a permit,
  // so no later permit (a stray one, a newer one) can loosen a limit. A limit is ONE setting per person (see the caps below), never a stack.
  // Forbids in `auto` only push an ask from "do it" to "hold for an adult"; forbids in `both` mean no.

  // an app or service the house has not allowed: hold for an adult. (The site builder is the house's own tool: no allowed-app list applies.)
  auto.service_unknown = `forbid(principal, action, resource) when { !context.service_known && action != Action::"build_site" };`;

  // low risk: anyone, known service
  for (const a of EVERYDAY_ACTIONS) auto[a] = `permit(principal, action == Action::${q(a)}, resource);`;
  auto.thermostat_range = `forbid(principal, action == Action::"thermostat", resource) when { context.value < 60 || context.value > 78 };`;

  // a connected app (S13): anyone signed in may use an app the house has allowed; guests never
  auto.use_app = `permit(principal, action == Action::"use_app", resource);`;
  auto.use_app_not_guests = `forbid(principal in Role::"guest", action == Action::"use_app", resource);`;

  // building and publishing a site: an adult with her own phone tap. Everyone else is held for an adult.
  auto.build_site = `permit(principal in Role::"adult", action == Action::"build_site", resource);`;
  auto.build_site_needs_phone = `forbid(principal, action == Action::"build_site", resource) when { context.session != "phone" };`;

  // Everyday things for anyone at home (switch, default on). Off: someone nobody confirmed can do nothing at all.
  if (c.guestEveryday === false) both('everyday_needs_a_person', `forbid(principal == Person::"guest", action, resource);`);

  // device class: adults only. Unlocking always needs the adult's own phone; the garage is a spoken heads-up with no tap.
  for (const a of c.adultsOnlyActions) {
    both(`adults_only_${a}`, `forbid(principal, action == Action::${q(a)}, resource) unless { principal in Role::"adult" };`);
    auto[`adult_${a}`] = `permit(principal in Role::"adult", action == Action::${q(a)}, resource);`;
    if (a !== 'garage') auto[`${a}_needs_phone`] = `forbid(principal, action == Action::${q(a)}, resource) when { context.session != "phone" };`;
  }
  // the garage: adults and teens, once confirmed. Children and guests never.
  auto.garage_open = `permit(principal, action == Action::"garage", resource) when { principal in Role::"adult" || principal in Role::"teen" };`;
  both('garage_not_for_kids', `forbid(principal, action == Action::"garage", resource) when { principal in Role::"child" || principal in Role::"guest" };`);

  // named guests: each has an allowed list and an end date (the end date is checked when the house loads people; a guest past it is gone)
  for (const g of c.guests ?? []) {
    const list = g.allowed.map((a) => `Action::${q(a)}`).join(', ');
    both(`guest_${g.id}_list`, g.allowed.length ? `forbid(principal == Person::${q(g.id)}, action, resource) unless { [${list}].contains(action) };` : `forbid(principal == Person::${q(g.id)}, action, resource);`);
  }

  // spend caps: ONE setting per person (a new limit replaces the old one in the config, so there is never a second rule to stack).
  // Buying is allowed, and a forbid holds it for an adult when it is over the person's limit, or the person has no limit at all.
  auto.purchase = `permit(principal, action == Action::"purchase", resource);`;
  const capped = Object.keys(c.weeklyCapCents);
  auto.purchase_needs_a_limit = capped.length ? `forbid(principal, action == Action::"purchase", resource) unless { [${capped.map((id) => `Person::${q(id)}`).join(', ')}].contains(principal) };` : `forbid(principal, action == Action::"purchase", resource);`;
  for (const [id, week] of Object.entries(c.weeklyCapCents)) {
    const per = c.perRequestCapCents[id] ?? week;
    auto[`cap_${id}`] = `forbid(principal == Person::${q(id)}, action == Action::"purchase", resource) when { context.amount_cents > ${per} || context.week_spent_cents + context.amount_cents > ${week} };`;
  }

  // private orders (S19): who may hear order history, delivery status and the cart. Adults always; others only if a card says so.
  const readers = [...new Set(['adult', ...(c.orderRoles ?? [])])];
  auto.gift_mark = `permit(principal in Role::"adult", action == Action::"mark_gift", resource);` // an adult marks an order as a gift
  readers.forEach((r) => (auto[`orders_${r}`] = `permit(principal in Role::${q(r)}, action in [Action::"order_history", Action::"order_status", Action::"cart"], resource);`));
  // a gift is never read aloud or shown to a child, a teen or a guest. A forbid in BOTH sets, and no card can switch it off.
  auto.gifts_adults = `permit(principal in Role::"adult", action == Action::"order_gift", resource);`;
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
  approvable.hold_known = `permit(principal, action, resource) when { [Action::"light", Action::"thermostat", Action::"music", Action::"weather", Action::"timer", Action::"unlock", Action::"garage", Action::"purchase", Action::"use_app", Action::"build_site"].contains(action) };`;
  approvable.guests_are_never_held = `forbid(principal in Role::"guest", action, resource);`;
  return { auto, approvable };
}
