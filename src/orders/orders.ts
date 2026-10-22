import { Store } from '../core/store.js';
import type { Deps } from '../core/request-action.js';
import { result, decideTraced } from '../core/request-action.js';
import { hourOf } from '../core/time.js';
import { decide } from '../policy/evaluator.js';
import { explainDecision } from '../policy/explain.js';
import type { RulesConfig } from '../policy/rules.js';
import type { ActionArgs, ActionResult, Person, SessionMethod } from '../core/types.js';
import { T } from '../text.js';
import { serviceKnownFor } from '../policy/kinds.js';

// S19: order history, delivery status and the cart are asked through request_action like everything else, and the same
// rules engine decides. Two questions: may this person hear orders at all (order_history / order_status / cart), and may
// they hear a GIFT (order_gift: adults only, a forbid no card can remove). The audit log never gets an item name.
export interface OrderRow {
  id: string;
  item: string;
  status: string; // "arrives Friday", "delivered Monday"
  by: string; // who ordered
  gift: boolean;
  giftFor?: string; // who it is for; only ever said to an adult
}

// the demo house: Mom has a gift on the way for Leo's birthday (the Tom's Guide story, docs/SPEC.md)
const SEED: { sk: string; row: OrderRow }[] = [
  { sk: 'ORDER#1', row: { id: '1', item: 'a Lego castle', status: 'arrives Friday', by: 'Mom', gift: true, giftFor: 'Leo' } },
  { sk: 'ORDER#2', row: { id: '2', item: 'paper towels', status: 'was delivered Monday', by: 'Mom', gift: false } },
  { sk: 'ORDER#3', row: { id: '3', item: 'a phone charger', status: 'arrives tomorrow', by: 'Dad', gift: false } },
  { sk: 'CART#1', row: { id: '1', item: 'a soccer ball', status: 'in the cart', by: 'Mom', gift: true, giftFor: 'Leo' } },
  { sk: 'CART#2', row: { id: '2', item: 'a book', status: 'in the cart', by: 'Mom', gift: false } },
];

export async function seedOrders(store: Store, hh: string): Promise<void> {
  for (const s of SEED) {
    await store.put({ pk: Store.hk(hh), sk: s.sk, ...s.row }, { ifNotExists: true }).catch((e: any) => {
      if (e?.name !== 'ConditionalCheckFailedException') throw e;
    });
  }
}

const rows = async (store: Store, hh: string, prefix: 'ORDER#' | 'CART#') => (await store.query(Store.hk(hh), prefix)) as unknown as OrderRow[];
const tell = (r: OrderRow, adult: boolean) => `${r.item}${adult && r.gift ? ` (a gift${r.giftFor ? ` for ${r.giftFor}` : ''})` : ''}`;

interface Ctx { person: Person; method: SessionMethod; rules: RulesConfig; tz: string; now: number; args: ActionArgs }

export async function handleOrders(deps: Deps, hh: string, c: Ctx): Promise<ActionResult> {
  const { person, rules, tz, now, args } = c;
  const input = { person: { id: person.id, role: person.role }, action: args.action, service: args.service, serviceKnown: serviceKnownFor(rules, args.service, args.action), amountCents: 0, weekSpentCents: 0, value: 0, session: c.method, localHour: hourOf(now, tz) };
  // nobody confirmed, a child, a guest, or a teen the card has not opened it to: one short plain answer, nothing else
  const first = decideTraced(deps, rules, input);
  const base = { person: person.id, person_name: person.name, service: args.service, action: args.action, rule: first.answer === 'allow' ? explainDecision(first, rules, person.name) : 'Rule: orders are private.' };
  if (first.answer !== 'allow') return result({ outcome: 'denied', reason: args.action === 'mark_gift' ? T.onlyAdults : T.private, done: false }, tz, now, base);

  // an adult marks an order as a gift: from then on it is never spoken or shown to a child, a teen or a guest (a forbid no card can remove)
  if (args.action === 'mark_gift') {
    const needle = String(args.item ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().slice(0, 40);
    const rawFor = String(args.value ?? '').replace(/[^A-Za-z ]/g, '').trim().slice(0, 20);
    const forWho = rawFor ? rawFor[0].toUpperCase() + rawFor.slice(1).toLowerCase() : '';
    if (needle.length < 3) return result({ outcome: 'denied', reason: T.noGiftFound, done: false }, tz, now, base);
    let marked = 0;
    for (const prefix of ['ORDER#', 'CART#'] as const) {
      for (const r of await rows(deps.store, hh, prefix)) {
        if (!r.item.toLowerCase().includes(needle)) continue;
        await deps.store.update({ Key: { pk: Store.hk(hh), sk: `${prefix}${r.id}` }, UpdateExpression: forWho ? 'SET gift = :t, giftFor = :f' : 'SET gift = :t', ExpressionAttributeValues: forWho ? { ':t': true, ':f': forWho } : { ':t': true } });
        marked++;
      }
    }
    if (!marked) return result({ outcome: 'denied', reason: T.noGiftFound, done: false }, tz, now, base);
    return result({ outcome: 'allowed', reason: T.giftMarked, done: true }, tz, now, base);
  }

  const all = await rows(deps.store, hh, args.action === 'cart' ? 'CART#' : 'ORDER#'); // a storage error throws → the caller holds
  const mayHearGifts = decide(rules, { ...input, action: 'order_gift' }).answer === 'allow';
  const shown = all.filter((r) => mayHearGifts || !r.gift);
  const hidden = shown.length < all.length;
  const adult = mayHearGifts;
  let say: string;
  if (!shown.length) say = args.action === 'cart' ? T.emptyCart : T.noOrders;
  else if (args.action === 'order_history') say = `Recent orders: ${shown.map((r) => tell(r, adult)).join('; ')}.`;
  else if (args.action === 'order_status') say = shown.map((r) => `The ${r.item.replace(/^an? /, '')} ${r.status}.`).join(' ');
  else say = `In the cart: ${shown.map((r) => tell(r, adult)).join('; ')}.`;
  if (hidden) say += ` ${T.someHidden}`;
  return result({ outcome: 'allowed', reason: say, done: true }, tz, now, { ...base, orders: shown.map((r) => ({ item: r.item, status: r.status, by: r.by, ...(adult && r.gift ? { gift: true, gift_for: r.giftFor } : {}) })) });
}
