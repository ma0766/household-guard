import type { PolicyDecision } from './evaluator.js';
import type { RulesConfig } from './rules.js';
import { money } from '../text.js';

// Which rule decided? Said in plain words for the audit sentence. The policy ids are ours; people only ever see these lines.
// Order matters: when several rules stop an ask, the first match here is the one named.
const BLOCKERS: [RegExp, (name: string, r: RulesConfig, id: string) => string][] = [
  [/^scam_guard$/, () => 'Rule: scams often start like this.'],
  [/^floor_guests_no_buy$/, () => "Rule: guests can't buy."],
  [/^floor_children_no_unlock$/, () => "Rule: children can't unlock doors."],
  [/^quiet_hours$/, () => 'Rule: quiet hours.'],
  [/^gifts_private$/, () => 'Rule: gifts stay private.'],
  [/^adults_only_(.+)$/, (_n, _r, id) => `Rule: only adults ${id.endsWith('garage') ? 'use the garage' : id.endsWith('unlock') ? 'unlock doors' : 'do that'}.`],
  [/^cap_(.+)$/, (n, r, id) => (r.weeklyCapCents[id.slice(4)] === undefined ? `Rule: ${n} has a limit.` : `Rule: ${n}'s ${money(r.weeklyCapCents[id.slice(4)])} a week.`)],
  [/^purchase_needs_a_limit$/, (n) => `Rule: ${n} has no limit yet.`],
  [/^service_unknown$/, () => 'Rule: that app is not allowed yet.'],
  [/^thermostat_range$/, () => 'Rule: the heat stays 60 to 78.'],
  [/_needs_phone$/, () => 'Rule: it needs your own phone.'],
  [/^use_app_not_guests$/, () => "Rule: guests can't use apps."],
  [/^everyday_needs_a_person$/, () => 'Rule: everyday things need a PIN or a tap.'],
  [/^garage_not_for_kids$/, () => "Rule: children and guests can't use the garage."],
  [/^guest_(.+)_list$/, (_n, r, id) => `Rule: ${r.guests?.find((g) => `guest_${g.id}_list` === id)?.name ?? 'the guest'}'s list does not have that.`],
  [/^guests_are_never_held$/, () => "Rule: guests can't do that."],
  [/^(deny|needs_approval)_\d+$/, () => 'Rule: a rule set by an adult.'],
];

const PERMITS: Record<string, string> = {
  light: 'Rule: lights are open to all.',
  thermostat: 'Rule: the heat is open to all.',
  use_app: 'Rule: allowed apps are open.',
  build_site: 'Rule: adults build sites.',
  adult_unlock: 'Rule: adults can unlock.',
  adult_garage: 'Rule: adults can open the garage.',
  gifts_adults: 'Rule: adults hear gifts.',
  gift_mark: 'Rule: adults mark gifts.',
  music: 'Rule: music is open to all.',
  weather: 'Rule: the weather is open to all.',
  timer: 'Rule: timers are open to all.',
  garage_open: 'Rule: adults and teens use the garage.',
};

export function explainDecision(d: PolicyDecision, rules: RulesConfig, name: string): string {
  const ids = d.answer === 'allow' ? d.determining : [...d.blockedBy, ...d.determining];
  for (const [re, say] of BLOCKERS) {
    const id = ids.find((x) => re.test(x));
    if (id) return say(name, rules, id);
  }
  if (d.answer === 'allow') {
    const cap = ids.find((x) => x === 'purchase') && rules.weeklyCapCents;
    if (ids.includes('purchase') && cap) return `Rule: within ${name}'s limit.`;
    if (ids.some((x) => x.startsWith('orders_'))) return 'Rule: adults hear orders.';
    for (const id of ids) if (PERMITS[id]) return PERMITS[id];
  }
  return d.answer === 'deny' ? 'Rule: nothing allows that.' : 'Rule: an adult must say yes.';
}
