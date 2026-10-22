import type { Deps } from '../core/request-action.js';
import { decidePrepared, prepareSets, type Answer, type PreparedSets } from '../policy/evaluator.js';
import { generatePolicies, type RulesConfig } from '../policy/rules.js';
import { serviceKnownFor } from '../policy/kinds.js';
import { Store } from '../core/store.js';
import type { AuditEntry } from '../audit/audit.js';
import type { SessionMethod } from '../core/types.js';
import type { Person } from '../core/types.js';
import { money } from '../text.js';

// TRY IT FIRST. Before a rule is saved, the house asks the same rules engine about each request it logged in the last 7 days,
// once under the old rules and once under the new ones, and says which answers would change. Plain rules code: no model, no guessing.
export const REPLAY_DAYS = 7;

export interface TryFirst {
  total: number; // requests looked at (for the person the change is about, or the whole house)
  changed: number;
  summary: string; // "With this rule, 1 of Maya's 3 requests would change."
  lines: string[]; // one short line per changed request
}

interface Logged {
  person: string;
  at: number;
  replay: { action: string; service: string; amount_cents: number; week_spent_cents: number; value: number; session: SessionMethod; hour: number };
}

// How a request would go, in words people use. A buy that is allowed still needs the person's tap unless they are on the no-tap list.
export function way(c: RulesConfig, p: Person, r: Logged['replay'], sets: PreparedSets = prepareSets(generatePolicies(c))): string {
  const d = decidePrepared(sets, { person: { id: p.id, role: p.role }, action: r.action, service: r.service, serviceKnown: serviceKnownFor(c, r.service, r.action), amountCents: r.amount_cents, weekSpentCents: r.week_spent_cents, value: r.value, session: r.session, localHour: r.hour });
  const answer: Answer = d.answer;
  if (answer === 'deny') return 'refused';
  if (answer === 'hold') return 'held for an adult';
  if (r.action === 'unlock' || r.action === 'build_site') return 'done after a tap';
  if (r.action === 'purchase') return r.session === 'pin' || (r.session === 'phone' && r.amount_cents <= (c.noTapBuyCents?.[p.id] ?? -1)) ? 'done with no tap' : 'done after a tap';
  return 'done at once';
}

const WHAT: Record<string, string> = { light: 'the lights', thermostat: 'the heat', music: 'music', weather: 'the weather', timer: 'a timer', unlock: 'the front door', garage: 'the garage', use_app: 'an app', build_site: 'a site', order_history: 'the orders', order_status: 'a delivery', cart: 'the cart', mark_gift: 'a gift mark' };
const what = (r: Logged['replay']) => (r.action === 'purchase' ? (r.service === 'mock-ride' ? `a ${money(r.amount_cents)} ride` : `a ${money(r.amount_cents)} buy`) : (WHAT[r.action] ?? 'something'));
const when = (ms: number, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(ms)).replace(',', '');

export async function tryFirst(deps: Deps, hh: string, before: RulesConfig, after: RulesConfig, people: Person[], tz: string, now: number, focusPersonId?: string): Promise<TryFirst> {
  // newest 1500 log rows at most: a busy house must not slow the reply down (the 500 ms rule)
  const rows = (await deps.store.query(Store.hk(hh), 'AUDIT#', { reverse: true, limit: 1500 })) as unknown as AuditEntry[];
  const logged: Logged[] = rows
    .filter((e) => e.kind === 'ask' && e.ts >= now - REPLAY_DAYS * 86400_000 && (e.data as any)?.replay && (!focusPersonId || e.person === focusPersonId))
    .map((e) => ({ person: e.person, at: e.ts, replay: (e.data as any).replay }))
    .reverse(); // oldest first
  const lines: string[] = [];
  const setsBefore = prepareSets(generatePolicies(before)); // read once, not once per request
  const setsAfter = prepareSets(generatePolicies(after));
  const memo = new Map<string, string>(); // the same question asked twice is answered once
  for (const l of logged.slice(-250)) {
    const p = people.find((x) => x.id === l.person);
    if (!p) continue; // someone who has left the house cannot be asked again
    const sig = JSON.stringify([p.id, p.role, l.replay]);
    const was = memo.get(`b${sig}`) ?? way(before, p, l.replay, setsBefore);
    const will = memo.get(`a${sig}`) ?? way(after, p, l.replay, setsAfter);
    memo.set(`b${sig}`, was);
    memo.set(`a${sig}`, will);
    if (was !== will) lines.push(`${when(l.at, tz)}: ${p.name} asked for ${what(l.replay)}. Was ${was}. Now ${will}.`);
  }
  const total = Math.min(logged.length, 250);
  const who = focusPersonId ? (people.find((x) => x.id === focusPersonId)?.name ?? 'the house') : '';
  const changed = lines.length;
  const noun = total === 1 ? 'request' : 'requests';
  const summary = !total
    ? who ? `No requests from ${who} in the last 7 days to try.` : 'No requests in the last 7 days to try.'
    : who ? `With this rule, ${changed === 0 ? 'none' : changed} of ${who}'s ${total} ${noun} would change.` : `With this rule, ${changed === 0 ? 'none' : changed} of ${total} ${noun} this week would change.`;
  return { total, changed, summary, lines: lines.slice(-12) };
}
