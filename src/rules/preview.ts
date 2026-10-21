import type { Person, Role } from '../core/types.js';
import type { RulesConfig } from '../policy/rules.js';
import { decide, type Answer, type DecisionInput } from '../policy/evaluator.js';
import { hourWord, money } from '../text.js';

// What would this change let people do? Asked of the same rules engine that decides real requests, over a fixed set of
// questions per kind of person. (The CI proofs in scripts/prove.ts settle the same thing for ALL requests, with a solver.)
const RANK: Record<Answer, number> = { deny: 0, hold: 1, allow: 2 };
const AMOUNTS = [1500, 2500, 3000, 5000, 25000, 60000];
const WHAT: Record<string, string> = { unlock: 'unlock the front door', garage: 'open the garage', purchase: 'buy things', thermostat: 'change the heat', light: 'turn lights on or off', use_app: 'use apps', build_site: 'publish a site' };
const WHO: Record<Role, string> = { adult: 'an adult', teen: 'a teen', child: 'a child', guest: 'a guest' };

function questions(p: Person, services: string[], known: (s: string) => boolean): DecisionInput[] {
  const base = { person: { id: p.id, role: p.role }, service: 'sim-home', serviceKnown: true, amountCents: 0, weekSpentCents: 0, value: 72, session: 'phone' as const, localHour: 12 };
  return [
    { ...base, action: 'light' },
    ...[60, 72, 95].map((value) => ({ ...base, action: 'thermostat', value })),
    ...['unlock', 'garage'].flatMap((action) => (['phone', 'pin'] as const).map((session) => ({ ...base, action, session }))),
    ...services.map((service) => ({ ...base, action: 'use_app', service, serviceKnown: known(service) })),
    ...services.flatMap((service) => AMOUNTS.map((amountCents) => ({ ...base, action: 'purchase', service, serviceKnown: known(service), amountCents }))),
  ];
}

export function previewChange(before: RulesConfig, after: RulesConfig, people: Person[]): string[] {
  const looser = new Map<string, string>();
  const stricter: string[] = [];
  const spendLines: string[] = [];

  // exact money: every changed weekly limit (said from the rule itself, so a tiny change is never missed)
  for (const p of people.filter((x) => x.role !== 'guest')) {
    const a = before.weeklyCapCents[p.id];
    const b = after.weeklyCapCents[p.id];
    if (a !== undefined && b !== undefined && b > a) spendLines.push(`This lets ${p.name} spend ${money(b - a)} more a week.`);
    else if (a !== undefined && b !== undefined && b < a) stricter.push(`${p.name} can spend ${money(a - b)} less a week.`);
    else if (a === undefined && b !== undefined) spendLines.push(`This lets ${p.name} buy up to ${money(b)} a week without asking.`);
    else if (a !== undefined && b === undefined) stricter.push(`${p.name} now needs a yes for every buy.`);
  }

  // quiet hours are a rule of the house, so they are read straight from the rule
  const qa = JSON.stringify(before.quietHours ?? null);
  const qb = JSON.stringify(after.quietHours ?? null);
  const quiet = qa === qb ? [] : after.quietHours ? [`Kids cannot buy from ${hourWord(after.quietHours.fromHour)} to ${hourWord(after.quietHours.toHour)}.`] : ['This lets kids buy at any hour.'];

  // best-value must-haves
  const haves: string[] = [];
  if (!before.mustHaves.bagIncluded && after.mustHaves.bagIncluded) haves.push('Cheaper rides must now include a bag.');
  if (before.mustHaves.bagIncluded && !after.mustHaves.bagIncluded) haves.push('Cheaper rides no longer need a bag.');
  if (after.mustHaves.arriveByHour !== undefined && after.mustHaves.arriveByHour !== before.mustHaves.arriveByHour) haves.push(`Cheaper rides must now arrive by ${hourWord(after.mustHaves.arriveByHour)}.`);
  if (before.mustHaves.arriveByHour !== undefined && after.mustHaves.arriveByHour === undefined) haves.push('Cheaper rides no longer need an arrival time.');

  // the rest: ask the rules about each kind of person, before and after. A service counts as known by each list's own rules.
  const flipped = [...new Set([...before.allowedServices, ...after.allowedServices])].filter((x) => before.allowedServices.includes(x) !== after.allowedServices.includes(x));
  for (const p of people) {
    for (const q of questions(p, p.role === 'guest' ? ['mock-ride'] : flipped, () => true)) {
      const isMoney = q.action === 'purchase';
      const was = RANK[decide(before, { ...q, serviceKnown: before.allowedServices.includes(q.service) }).answer];
      const now = RANK[decide(after, { ...q, serviceKnown: after.allowedServices.includes(q.service) }).answer];
      if (isMoney && p.role !== 'guest' && !flipped.includes(q.service)) continue; // limits and quiet hours are said exactly above
      if (now > was) looser.set(`${p.role}-${q.action}`, `This change lets ${WHO[p.role]} ${WHAT[q.action]}. Are you sure?`);
      else if (now < was) stricter.push(`This is stricter for ${WHO[p.role]}: ${WHAT[q.action]}.`);
    }
  }
  const lines = [...looser.values(), ...spendLines, ...quiet.filter((x) => x.startsWith('This lets')), ...[...new Set(stricter)], ...quiet.filter((x) => !x.startsWith('This lets')), ...haves];
  return lines.length ? lines : ['This changes nothing for now.'];
}
