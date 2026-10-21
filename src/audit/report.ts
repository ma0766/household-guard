import { connectorState } from '../connectors/healing.js';
import type { Deps } from '../core/request-action.js';
import { Store } from '../core/store.js';
import { loadHousehold } from '../core/household.js';
import { localDate, weekKey } from '../core/time.js';
import { readAudit, type AuditEntry } from './audit.js';
import { money } from '../text.js';
import { openApprovals } from '../approvals/approvals.js';
import { isLocked } from '../identity/guard.js';
import { readHome } from '../connectors/sim-home.js';
import { spentThisWeek } from '../spend/spend.js';

export const ICON: Record<string, string> = { cart: '🛒', lock: '🔒', light: '💡', rule: '📝', who: '🔑', home: '🏠' };

export interface Spoken {
  say: string;
  spent_cents: number;
  buys: number;
  saved_cents: number;
  entries: { text: string; person: string; category: string; ts: number }[];
}

type When = 'today' | 'this week' | 'last week';

// "What did the kids buy this week?" → totals first, in two or three short sentences.
export async function voiceSummary(deps: Deps, hh: string, q: { who?: string; when?: string }): Promise<Spoken> {
  const { meta, people } = await loadHousehold(deps.store, hh);
  const now = (deps.now ?? Date.now)();
  const asked = (q.when ?? 'this week').toLowerCase();
  if (!/today|this week|last week/.test(asked)) return { say: 'I can tell you about today, this week, or last week.', spent_cents: 0, buys: 0, saved_cents: 0, entries: [] };
  const when: When = /last/.test(asked) ? 'last week' : /today/.test(asked) ? 'today' : 'this week';
  const thisWeek = weekKey(now, meta.timezone);
  const lastWeek = weekKey(Date.parse(thisWeek + 'T12:00:00Z') - 7 * 86400_000, 'UTC');
  const inRange = (e: AuditEntry) => (when === 'today' ? e.day === localDate(now, meta.timezone) : weekKey(e.ts, meta.timezone) === (when === 'this week' ? thisWeek : lastWeek));

  const who = (q.who ?? 'kids').toLowerCase();
  const kids = people.filter((p) => p.role === 'teen' || p.role === 'child').map((p) => p.id);
  const match = (id: string) => (who === 'kids' || who === 'children' ? kids.includes(id) : who === 'everyone' || who === 'all' ? true : id === who || people.find((p) => p.id === id)?.name.toLowerCase() === who);
  const subject = who === 'kids' || who === 'children' ? 'The kids' : who === 'everyone' || who === 'all' ? 'The house' : (people.find((p) => p.id === who || p.name.toLowerCase() === who)?.name ?? 'They');

  const all = (await readAudit(deps.store, hh, { limit: 1000 })).filter((e) => inRange(e) && match(e.person));
  const buys = all.filter((e) => e.kind === 'done' && e.category === 'cart');
  const spent = buys.reduce((n, e) => n + Number((e.data as any)?.amount_cents ?? 0), 0);
  const saved = all.filter((e) => e.kind === 'saving').reduce((n, e) => n + Number((e.data as any)?.saved_cents ?? 0), 0);
  const entries = buys.map((e) => ({ text: e.text, person: e.person, category: e.category, ts: e.ts }));

  if (!buys.length) return { say: `${subject} bought nothing ${when}.`, spent_cents: 0, buys: 0, saved_cents: 0, entries };
  const last = buys[0];
  const parts = [`${subject} spent ${money(spent)} ${when}.`, `That is ${buys.length} ${buys.length === 1 ? 'buy' : 'buys'}. The last was ${last.personName}'s, ${money(Number((last.data as any)?.amount_cents))}.`];
  if (saved > 0) parts.push(`You saved ${money(saved)}.`);
  return { say: parts.join(' '), spent_cents: spent, buys: buys.length, saved_cents: saved, entries };
}

export async function householdStatus(deps: Deps, hh: string) {
  const { meta, people, rules } = await loadHousehold(deps.store, hh);
  const now = (deps.now ?? Date.now)();
  const week = weekKey(now, meta.timezone);
  const waiting = (await openApprovals(deps, hh)).length;
  const members = [];
  for (const p of people.filter((x) => x.role !== 'guest')) {
    const spent = await spentThisWeek(deps.store, hh, week, p.id);
    const cap = rules.weeklyCapCents[p.id];
    members.push({ id: p.id, name: p.name, role: p.role, has_phone: p.hasPhone, locked: await isLocked(deps.store, hh, p.id, now), spent_cents: spent, cap_cents: cap ?? null, left_cents: cap === undefined ? null : Math.max(0, cap - spent) });
  }
  const sentences = [waiting ? `${waiting} ${waiting === 1 ? 'thing is' : 'things are'} waiting for an adult.` : 'Your house is quiet. Nothing is waiting.'];
  for (const m of members.filter((x) => x.left_cents !== null && x.role !== 'adult')) sentences.push(`${m.name} has ${money(m.left_cents as number)} left this week.`);
  const ride = await connectorState(deps.store, hh);
  if (ride.health === 'broken') sentences.push('The ride service is not working. An adult was told.');
  else if (ride.approvalOwed) sentences.push('The ride service was just fixed. The next ride needs a yes.');
  return { say: sentences.join(' '), members, waiting_approvals: waiting, connectors: { ride: { health: ride.health, approval_owed: ride.approvalOwed, version: ride.activeVersion } }, devices: await readHome(deps.store, hh), timezone: meta.timezone };
}

export async function recentOrders(store: Store, hh: string, limit = 10): Promise<AuditEntry[]> {
  return (await readAudit(store, hh, { category: 'cart', limit: 200 })).filter((e) => e.kind === 'done').slice(0, limit);
}
