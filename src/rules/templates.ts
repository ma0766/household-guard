import type { Person } from '../core/types.js';
import { EVERYDAY_ACTIONS, KNOWN_ACTIONS, type RulesConfig } from '../policy/rules.js';
import { validateRules } from '../policy/evaluator.js';
import { hourWord, money } from '../text.js';

// Four rule cards (plus the locked floor). Nobody types Cedar: a card turns into a config, the config turns into
// Cedar, and the Cedar is checked against the schema BEFORE anything is saved.
export type RuleChange =
  | { template: 'weekly_limit'; person: string; cents: number }
  | { template: 'adults_only'; actions: string[] }
  | { template: 'allowed_apps'; services: string[] }
  | { template: 'must_haves'; bagIncluded?: boolean; arriveByHour?: number | null }
  | { template: 'private_orders'; roles: ('teen' | 'child')[] }
  | { template: 'quiet_hours'; fromHour: number | null; toHour?: number }
  | { template: 'guest_switch'; enabled: boolean }
  | { template: 'add_guest'; name: string; allowed: string[]; until: string } // until = a date, YYYY-MM-DD, in the house's own zone (end of that day)
  | { template: 'end_guest'; id: string }
  | { template: 'no_tap_buys'; person: string; cents: number | null }
  | { template: 'floor'; which: 'childrenNoUnlock' | 'guestsNoBuy'; enabled: boolean };

export const MAX_CENTS = 1_000_000; // $10,000 — a typo guard, not a policy

export function isFloorLoosening(c: RuleChange): boolean {
  return c.template === 'floor' && c.enabled === false;
}

export type Applied = { ok: true; config: RulesConfig; sentence: string; warning?: string } | { ok: false; error: string };

export function applyChange(before: RulesConfig, change: RuleChange, people: Person[], ctx: { now?: number; tz?: string } = {}): Applied {
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
    case 'quiet_hours': {
      if (change.fromHour === null) {
        delete next.quietHours;
        sentence = 'Quiet hours are off.';
        break;
      }
      const { fromHour: f, toHour: t } = change;
      if (![f, t].every((h) => Number.isInteger(h) && (h as number) >= 0 && (h as number) <= 23) || f === t) return { ok: false, error: 'That hour does not look right.' };
      next.quietHours = { fromHour: f, toHour: t as number };
      sentence = `No buying for kids from ${hourWord(f)} to ${hourWord(t as number)}.`;
      break;
    }
    case 'private_orders': {
      if (!Array.isArray(change.roles) || change.roles.some((r) => r !== 'teen' && r !== 'child')) return { ok: false, error: 'Only teens and children can be added.' };
      next.orderRoles = [...new Set(change.roles)].sort();
      const names = next.orderRoles.map((r) => (r === 'teen' ? 'teens' : 'children'));
      sentence = names.length ? `Adults and ${names.join(' and ')} hear orders. Gifts stay private.` : 'Only adults hear orders.';
      const added = names.filter((n) => !(before.orderRoles ?? []).map((r) => (r === 'teen' ? 'teens' : 'children')).includes(n));
      if (added.length) warning = `This lets ${added.join(' and ')} hear what the house ordered. Gifts stay private.`;
      break;
    }
    case 'guest_switch': {
      next.guestEveryday = !!change.enabled;
      sentence = change.enabled ? 'Everyday things are open to anyone at home.' : 'Everyday things now need a PIN or a tap.';
      if (change.enabled && before.guestEveryday === false) warning = 'This lets anyone at home use lights, music and more.';
      break;
    }
    case 'add_guest': {
      const name = String(change.name ?? '').replace(/[^A-Za-z ]/g, '').trim().slice(0, 20);
      const slug = name.toLowerCase().replace(/ +/g, '-');
      if (name.length < 2) return { ok: false, error: 'What is the guest called?' };
      if (people.some((p) => p.name.toLowerCase() === name.toLowerCase() && p.id !== `g-${slug}`)) return { ok: false, error: 'Someone has that name.' };
      if (!Array.isArray(change.allowed) || change.allowed.some((a) => !(EVERYDAY_ACTIONS as readonly string[]).includes(a))) return { ok: false, error: 'A guest can have lights, heat, music, weather and timers.' };
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(change.until ?? ''));
      const untilMs = m ? endOfDayMs(Number(m[1]), Number(m[2]), Number(m[3]), ctx.tz ?? 'America/New_York') : NaN;
      if (!Number.isFinite(untilMs)) return { ok: false, error: 'Until what day?' };
      if (untilMs <= (ctx.now ?? Date.now())) return { ok: false, error: 'That day has passed.' };
      if (untilMs > (ctx.now ?? Date.now()) + 365 * 86400_000) return { ok: false, error: 'A guest can stay up to a year.' };
      next.guests = [...(before.guests ?? []).filter((g) => g.id !== `g-${slug}`), { id: `g-${slug}`, name, allowed: [...new Set(change.allowed)].sort(), untilMs }];
      sentence = `${name} is a guest until ${change.until}. They can use: ${next.guests.find((g) => g.id === `g-${slug}`)!.allowed.join(', ') || 'nothing yet'}.`;
      break;
    }
    case 'end_guest': {
      const g = (before.guests ?? []).find((x) => x.id === change.id);
      if (!g) return { ok: false, error: "I don't know that guest." };
      next.guests = (before.guests ?? []).filter((x) => x.id !== change.id);
      sentence = `${g.name} is no longer a guest.`;
      break;
    }
    case 'no_tap_buys': {
      const p = people.find((x) => x.id === change.person && (x.role === 'adult' || x.role === 'teen'));
      if (!p) return { ok: false, error: "I don't know that person." };
      next.noTapBuyCents = { ...(before.noTapBuyCents ?? {}) };
      if (change.cents === null) {
        delete next.noTapBuyCents[p.id];
        sentence = `${p.name} taps for every buy.`;
        break;
      }
      if (!Number.isInteger(change.cents) || change.cents < 100 || change.cents > 5000) return { ok: false, error: 'Small buys can be $1 to $50.' };
      next.noTapBuyCents[p.id] = change.cents;
      sentence = `${p.name} can buy up to ${money(change.cents)} with no tap.`;
      warning = `This lets ${p.name} buy small things with no tap.`;
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

// the last instant of a calendar day in the house's own zone (so "until Friday" means through Friday night)
export function endOfDayMs(y: number, mo: number, d: number, tz: string): number {
  let guess = Date.UTC(y, mo - 1, d, 23, 59, 59);
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
    const seen = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
    guess += Date.UTC(y, mo - 1, d, 23, 59, 59) - seen;
  }
  return guess;
}
