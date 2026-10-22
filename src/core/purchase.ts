import { explainDecision } from '../policy/explain.js';
import { randomUUID } from 'node:crypto';
import type { Deps } from './request-action.js';
import { result, decideTraced } from './request-action.js';
import type { ActionArgs, ActionResult, Person } from './types.js';
import type { SessionMethod } from './types.js';
import type { RulesConfig } from '../policy/rules.js';
import { decide } from '../policy/evaluator.js';
import { hourOf, weekKey } from './time.js';
import { release, releaseExpired, reserve, spentThisWeek, RESERVATION_MS } from '../spend/spend.js';
import { ConnectorError, MOCK_RIDE, quoteRide, type RideOption } from '../connectors/mock-ride.js';
import { connectorState } from '../connectors/healing.js';
import { createApproval, getApproval, supersede } from '../approvals/approvals.js';
import { MOCK_SHOP, quoteItem, knownPayee } from '../connectors/mock-shop.js';
import { scamKindOf } from '../policy/scam.js';
import { openChallenge } from '../approvals/challenge.js';
import { createJob } from '../jobs/worker.js';
import { T } from '../text.js';
import { serviceKnownFor } from '../policy/kinds.js';
import { tapCovers } from '../identity/tapwindow.js';

export interface PurchaseCtx {
  person: Person;
  method: SessionMethod;
  rules: RulesConfig;
  tz: string;
  now: number;
  args: ActionArgs;
}

// The price is NEVER an argument. The server asks the service for the total (price plus fees) — a caller cannot lie about it.
export async function handlePurchase(deps: Deps, hh: string, c: PurchaseCtx): Promise<ActionResult> {
  const { person, method, rules, tz, now, args } = c;
  const base = { person: person.id, person_name: person.name, service: args.service, action: 'purchase' };
  await releaseExpired(deps.store, hh, now); // an untapped yes must not lock the cap

  let amount: number;
  let optionId: string | undefined;
  let itemKey: string;
  let rideOptions: RideOption[] = [];
  let scam = false; // the scam guard (src/policy/scam.ts)
  let owed = false; // a freshly repaired service: one adult yes before money moves (S11)
  if (args.service === MOCK_RIDE) {
    const cs = await connectorState(deps.store, hh);
    if (cs.health === 'broken') return result({ outcome: 'held', reason: T.serviceDown, done: false }, tz, now, base);
    owed = cs.approvalOwed;
    let q;
    try {
      q = await quoteRide(deps.store, hh, args.item);
    } catch (e) {
      if (e instanceof ConnectorError) return result({ outcome: 'held', reason: T.serviceDown, done: false }, tz, now, base); // the service's answer no longer fits: never guess a price
      throw e;
    }
    if (!q) return result({ outcome: 'denied', reason: T.cantFind, done: false }, tz, now, base);
    const opt = q.options.find((o) => o.id === (args.option_id ?? 'standard'));
    if (!opt) return result({ outcome: 'denied', reason: T.cantFind, done: false }, tz, now, base);
    amount = opt.total_cents;
    optionId = opt.id;
    itemKey = `${q.destination}/${opt.id}`;
    rideOptions = q.options;
  } else if (args.service === MOCK_SHOP) {
    const q = quoteItem(args.item);
    if (!q) return result({ outcome: 'denied', reason: T.cantFind, done: false }, tz, now, base);
    amount = q.total_cents;
    itemKey = q.item;
    scam = scamKindOf(q.item, q.payee, q.payee ? await knownPayee(deps.store, hh, q.payee) : true) !== undefined;
  } else {
    return result({ outcome: 'held', reason: T.newService, done: false }, tz, now, base);
  }

  const week = weekKey(now, tz);
  const spent = await spentThisWeek(deps.store, hh, week, person.id);
  const d = decideTraced(deps, rules, { person: { id: person.id, role: person.role }, action: 'purchase', service: args.service, serviceKnown: serviceKnownFor(rules, args.service, 'purchase'), amountCents: amount, weekSpentCents: spent, value: 0, session: method, scam, localHour: hourOf(now, tz) });
  const extra = { ...base, amount_cents: amount, option_id: optionId, rule: explainDecision(d, rules, person.name) };

  if (d.answer === 'deny') {
    const reason = d.determining.includes('quiet_hours') && rules.quietHours ? T.quietHours(rules.quietHours.fromHour, rules.quietHours.toHour) : d.determining.includes('floor_guests_no_buy') ? T.guestNoBuy : person.role === 'guest' ? T.whoAreYou : T.cantDo;
    return result({ outcome: 'denied', reason, done: false }, tz, now, extra);
  }
  if (d.answer === 'hold' || (d.answer === 'allow' && owed)) {
    // Held for an adult. Offer the lowest total that the rules allow and that meets the person's must-haves.
    const reason = d.answer === 'allow' ? T.afterRepair : d.blockedBy.includes('scam_guard') ? T.scam : heldReason(rules, person, amount, spent);
    const alt = owed ? undefined : bestValue(rules, person, method, args.service, rideOptions, amount, spent, now, tz);
    const a = await createApproval(deps, hh, { personId: person.id, personName: person.name, service: args.service, itemText: args.item, itemKey, optionId, amountCents: amount, reason, rule: extra.rule, ...(d.blockedBy.includes('scam_guard') ? { scam: true } : {}) });
    const say = [reason, alt ? `${T.altOffer(alt.label.toLowerCase(), alt.total_cents)} ${T.wantThat}` : '', T.adultCanTap(a.number)].filter(Boolean).join(' ');
    const out = result({ outcome: 'held', reason, done: false }, tz, now, { ...extra, approval_id: a.id, number: a.number, ...(alt ? { alternative: { option_id: alt.id, label: alt.label, total_cents: alt.total_cents, saves_cents: amount - alt.total_cents, note: T.lowestWeFound } } : {}) });
    out.say = say;
    return out;
  }

  // Taking the cheaper option instead of a held one? Remember what it saved (server-computed from the held approval, never from the caller).
  let replacesApprovalId: string | undefined;
  let savedCents: number | undefined;
  if (args.replaces) {
    const old = await getApproval(deps, hh, args.replaces);
    // same person, same service, same destination, and genuinely cheaper — then close the held one NOW (atomically),
    // so it can't be approved too, and can't be claimed twice
    if (old && old.personId === person.id && old.service === args.service && old.status === 'open' && old.amountCents > amount && old.itemKey.split('/')[0] === itemKey.split('/')[0]) {
      try {
        await supersede(deps, hh, old.id, true);
        replacesApprovalId = old.id;
        savedCents = old.amountCents - amount;
      } catch {
        /* someone else closed it first: no saving to claim */
      }
    }
  }

  // The rules said yes. Now the database has the last word: reserve the money in one conditional transaction.
  await deps.hooks?.beforeReserve?.();
  const jobId = randomUUID().slice(0, 12);
  const reservationId = randomUUID();
  const cap = rules.weeklyCapCents[person.id] ?? 0;
  const got = await reserve(deps.store, hh, { id: reservationId, person: person.id, amount, week, expiresAt: now + RESERVATION_MS }, cap);
  if (got === 'cap') {
    // Lost a race for the last of the limit (another buy took it first). Same answer as any other over-the-limit ask: held for an adult,
    // with the card on the adult's phone. (Before: a bare "Held" with no card, so nobody could ever say yes to it.)
    const spentNow = Math.max(spent, cap - amount + 1);
    const reason = heldReason(rules, person, amount, spentNow);
    const alt = owed ? undefined : bestValue(rules, person, method, args.service, rideOptions, amount, spentNow, now, tz);
    const a = await createApproval(deps, hh, { personId: person.id, personName: person.name, service: args.service, itemText: args.item, itemKey, optionId, amountCents: amount, reason, rule: 'Rule: the limit ran out first.' });
    const out = result({ outcome: 'held', reason, done: false }, tz, now, { ...extra, rule: "Rule: the limit ran out first.", why: 'cap_race', approval_id: a.id, number: a.number, ...(alt ? { alternative: { option_id: alt.id, label: alt.label, total_cents: alt.total_cents, saves_cents: amount - alt.total_cents, note: T.lowestWeFound } } : {}) });
    out.say = [reason, alt ? `${T.altOffer(alt.label.toLowerCase(), alt.total_cents)} ${T.wantThat}` : '', T.adultCanTap(a.number)].filter(Boolean).join(' ');
    return out;
  }

  const meta = { purchase: { jobId, reservationId, amountCents: amount, optionId, replacesApprovalId, savedCents } };
  try {
    // A tap is needed for a buy, except: a PIN (no phone), a small buy the adult put on this person's no-tap list, or a buy inside the
    // 5 minutes after this person's own tap. The rules (limits, quiet hours) already said yes to this exact buy.
    const small = method === 'phone' && amount <= (rules.noTapBuyCents?.[person.id] ?? -1);
    const covered = method === 'phone' && !small && (await tapCovers(deps.store, hh, person.id, now));
    if (method === 'pin' || small || covered) {
      await createJob(deps, hh, { id: jobId, personId: person.id, service: args.service, item: args.item, optionId, amountCents: amount, reservationId, replacesApprovalId, savedCents });
      return result({ outcome: 'allowed', reason: T.booking, done: false }, tz, now, { ...extra, job_id: jobId, ...(small || covered ? { tap: small ? 'not_needed_small' : 'not_needed_covered' } : {}) });
    }
    const { challenge, locked } = await openChallenge(deps, hh, person, 'action', args, meta);
    if (locked || !challenge) {
      await release(deps.store, hh, reservationId);
      return result({ outcome: 'held', reason: T.locked, done: false }, tz, now, extra);
    }
    return result({ outcome: 'allowed', reason: T.confirmOnPhone(challenge.number), done: false }, tz, now, { ...extra, next: 'confirm_on_phone', number: challenge.number, job_id: challenge.id, tier: 'medium' });
  } catch (e) {
    await release(deps.store, hh, reservationId).catch(() => undefined); // never leave money reserved behind an error
    throw e;
  }
}

function heldReason(rules: RulesConfig, person: Person, amount: number, spent: number): string {
  const cap = rules.weeklyCapCents[person.id];
  if (cap === undefined) return T.childNoBuy;
  if (spent + amount > cap) return T.overWeekly(person.name, cap);
  return T.overOneBuy(person.name, rules.perRequestCapCents[person.id] ?? cap);
}

// Best value = lowest TOTAL (price plus fees) that the rules allow and that meets must-haves. Only offered if it is cheaper.
function bestValue(rules: RulesConfig, person: Person, method: SessionMethod, service: string, options: RideOption[], asked: number, spent: number, now: number, tz: string): RideOption | undefined {
  const fits = options.filter((o) => {
    if (o.total_cents >= asked) return false;
    if (rules.mustHaves.bagIncluded && !o.bag_included) return false;
    if (rules.mustHaves.arriveByHour !== undefined) {
      const [h, m] = formatLocal24(now + o.eta_minutes * 60_000, tz);
      if (h * 60 + m > rules.mustHaves.arriveByHour * 60) return false;
    }
    return decide(rules, { person: { id: person.id, role: person.role }, action: 'purchase', service, serviceKnown: serviceKnownFor(rules, service, 'purchase'), amountCents: o.total_cents, weekSpentCents: spent, value: 0, session: method, localHour: hourOf(now, tz) }).answer === 'allow';
  });
  return fits.sort((a, b) => a.total_cents - b.total_cents)[0];
}

function formatLocal24(ts: number, tz: string): [number, number] {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return [Number(p.hour) % 24, Number(p.minute)];
}
