import type { Deps } from '../core/request-action.js';
import { Store } from '../core/store.js';
import { timeOfDay } from '../core/time.js';
import { tryAudit, type Category } from './audit.js';
import { money } from '../text.js';
import type { ActionArgs, ActionResult } from '../core/types.js';
import type { DecisionInput } from '../policy/evaluator.js';

// Every sentence in the log is built here, once, in plain words (no tech words, short sentences).
export const categoryOf = (action: string): Category => (action === 'purchase' || action === 'order_history' || action === 'order_status' || action === 'cart' ? 'cart' : action === 'unlock' || action === 'garage' ? 'lock' : action === 'light' || action === 'thermostat' ? 'light' : 'home');

async function tzOf(deps: Deps, hh: string): Promise<string> {
  try {
    return ((await deps.store.get(Store.hk(hh), 'META'))?.timezone as string) ?? 'America/New_York';
  } catch {
    return 'America/New_York';
  }
}

// The log never changes an answer: building and writing a sentence can fail loudly in the logs, but never throws to the caller.
export async function emit(deps: Deps, hh: string, e: { kind: string; category: Category; person: string; personName: string; text: (t: string) => string; data?: Record<string, unknown> }): Promise<void> {
  try {
    const tz = await tzOf(deps, hh);
    const t = timeOfDay((deps.now ?? Date.now)(), tz);
    await tryAudit(deps, hh, tz, { kind: e.kind, category: e.category, person: e.person, personName: e.personName, text: e.text(t).slice(0, 240), data: e.data });
  } catch (err) {
    console.error('AUDIT EMIT FAILED', e.kind, err);
  }
}

// words from a caller are never copied into a sentence as they are
const KNOWN = ['light', 'thermostat', 'music', 'weather', 'timer', 'unlock', 'garage', 'purchase', 'vacuum', 'camera'];
const safeWord = (v: unknown, max = 12) => String(v ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, max).trim();

function what(a: ActionArgs): string {
  switch (a.action) {
    case 'light': return `turn the lights ${safeWord(a.value) || 'on'}`;
    case 'unlock': return 'unlock the front door';
    case 'garage': return 'open the garage';
    case 'order_history': return 'hear about orders';
    case 'order_status': return 'check on a delivery';
    case 'cart': return 'look in the cart';
    case 'mark_gift': return 'mark an order as a gift';
    case 'music': return 'play music';
    case 'weather': return 'ask about the weather';
    case 'timer': return 'set a timer';
    case 'vacuum': return 'run the vacuum';
    case 'camera': return 'look at the hallway camera';
    case 'connect_device': return 'add a device';
    case 'start_project': return 'start a project';
    case 'publish_project': return 'publish a project';
    case 'thermostat': return `set the heat to ${safeWord(a.value, 3) || 'something'}`;
    default: return KNOWN.includes(a.action) ? a.action : 'do something I do not know';
  }
}

const purchaseWhat = (a: ActionArgs, amount?: number) => (a.service === 'mock-ride' ? `a ${amount !== undefined ? money(amount) + ' ' : ''}ride` : `a ${safeWord(a.item, 24) || 'thing'}`);

export async function auditAsk(deps: Deps, hh: string, a: ActionArgs, r: ActionResult, input?: DecisionInput): Promise<void> {
  try {
    await auditAskInner(deps, hh, a, r, input);
  } catch (err) {
    console.error('AUDIT ASK FAILED', err);
  }
}

async function auditAskInner(deps: Deps, hh: string, a: ActionArgs, r: ActionResult, input?: DecisionInput): Promise<void> {
  const name = (r.person_name as string) ?? 'Someone';
  const amount = r.amount_cents as number | undefined;
  const rule = typeof r.rule === 'string' && r.rule ? ` ${r.rule}` : ''; // which rule decided, in plain words
  const outcome =
    r.outcome === 'allowed' ? (r.done ? 'Done.' : r.next === 'confirm_on_phone' ? `Waiting for ${name}'s phone.` : 'Okay.') : r.outcome === 'held' ? (String(r.reason).startsWith('Held') ? r.reason : `Held. ${r.reason}`) : `No. ${r.reason}`;
  await emit(deps, hh, {
    kind: 'ask',
    category: categoryOf(a.action),
    person: (r.person as string) ?? 'guest',
    personName: name,
    text: (t) => (a.action === 'purchase' ? `${name} asked for ${purchaseWhat(a, amount)} at ${t}. ${outcome}${rule}` : `${name} asked to ${what(a)} at ${t}. ${outcome}${rule}`),
    data: {
      outcome: r.outcome, service: a.service, action: a.action, amount_cents: amount ?? null, rule: r.rule ?? null,
      // what the rules were asked, so a new rule can be tried on this request later (numbers and words from OUR side only: never an item name)
      ...(input ? { replay: { action: input.action, service: input.service, amount_cents: input.amountCents, week_spent_cents: input.weekSpentCents, value: input.value, session: input.session, hour: input.localHour } } : {}),
    },
  });
}

export const doneHome = (name: string, a: ActionArgs, t: string) =>
  a.action === 'unlock' ? `${name} unlocked the front door at ${t}.` : a.action === 'garage' ? `${name} opened the garage at ${t}.` : a.action === 'light' ? `${name} turned the lights ${a.value ?? 'on'} at ${t}.` : `${name} did it at ${t}.`;
