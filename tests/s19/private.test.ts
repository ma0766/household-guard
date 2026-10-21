import { describe, expect, it } from 'vitest';
import { newHousehold, speakAs, type Who } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';
import { readAudit } from '../../src/audit/audit.js';
import { applyChange } from '../../src/rules/templates.js';
import { defaultRules } from '../../src/policy/rules.js';
import { validateRules } from '../../src/policy/evaluator.js';
import { loadHousehold } from '../../src/core/household.js';
import { rulesHtml } from '../../src/rules/change.js';
import { Store } from '../../src/core/store.js';

// S19: private things stay private. Mom's order for Leo's birthday must never reach Leo, Maya or a guest.
const ITEMS = /lego|castle|soccer/i; // the gift names seeded into every house
const ask = (action: string) => ({ service: 'mock-shop', action });
async function as(who: Who, action: string, method: 'phone' | 'pin' = who === 'leo' ? 'pin' : 'phone') {
  const ctx = await newHousehold();
  await speakAs(ctx.store, ctx.hh, who, method);
  const r = await requestAction(ctx.deps, ctx.hh, ask(action));
  return { ctx, r };
}

describe('S19 private things stay private', () => {
  it('Leo asks "what did Mom order?": a short plain reply, no item names anywhere, not in the timeline either', async () => {
    const { ctx, r } = await as('leo', 'order_history');
    expect(r.outcome).toBe('denied');
    expect(r.say).toBe("That's private. Ask a grown-up.");
    expect(JSON.stringify(r)).not.toMatch(ITEMS);
    expect(JSON.stringify(r)).not.toMatch(/paper towels|charger/i);
    const log = JSON.stringify(await readAudit(ctx.store, ctx.hh));
    expect(log).not.toMatch(ITEMS);
    expect(log).not.toMatch(/paper towels|charger/i);
    expect(log).toMatch(/Leo asked to hear about orders/); // the ask is logged, only without names
  });

  it('Mom asks and hears the list, including the gift; the timeline still holds no item names', async () => {
    const { ctx, r } = await as('mom', 'order_history');
    expect(r.outcome).toBe('allowed');
    expect(r.done).toBe(true);
    expect(r.say).toMatch(/Lego castle/);
    expect(r.say).toMatch(/paper towels/);
    expect(JSON.stringify(await readAudit(ctx.store, ctx.hh))).not.toMatch(ITEMS);
  });

  it('delivery status and cart follow the same rule: Mom hears, Leo and Maya do not', async () => {
    for (const action of ['order_status', 'cart']) {
      const mom = await as('mom', action);
      expect(mom.r.outcome, action).toBe('allowed');
      expect(mom.r.say.length).toBeGreaterThan(10);
      for (const who of ['leo', 'maya'] as const) {
        const k = await as(who, action);
        expect(k.r.outcome, `${who} ${action}`).toBe('denied');
        expect(JSON.stringify(k.r)).not.toMatch(ITEMS);
      }
    }
  });

  it('a guest is denied and learns nothing', async () => {
    const { ctx, r } = await as('guest', 'order_history');
    expect(r.outcome).toBe('denied');
    expect(r.done).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(ITEMS);
    expect(JSON.stringify(await readAudit(ctx.store, ctx.hh))).not.toMatch(ITEMS);
  });

  it('an unconfirmed person is a guest: no name, no list', async () => {
    const ctx = await newHousehold();
    const r = await requestAction(ctx.deps, ctx.hh, ask('order_history'));
    expect(r.outcome).toBe('denied');
    expect(JSON.stringify(r)).not.toMatch(ITEMS);
  });

  it('the rule card: an adult lets teens hear orders; the gift is STILL never read to a teen', async () => {
    const ctx = await newHousehold();
    const { people, rules } = await loadHousehold(ctx.store, ctx.hh);
    const a = applyChange(rules, { template: 'private_orders', roles: ['teen'] }, people);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.warning).toMatch(/teens/i);
    expect(validateRules(a.config).ok).toBe(true);
    await ctx.store.put({ pk: Store.hk(ctx.hh), sk: 'RULES#current', config: a.config });
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    const r = await requestAction(ctx.deps, ctx.hh, ask('order_history'));
    expect(r.outcome).toBe('allowed');
    expect(r.say).toMatch(/paper towels/); // an ordinary order is fine for her now
    expect(JSON.stringify(r)).not.toMatch(ITEMS); // the gift is not
    expect(r.say).toMatch(/private/i); // she is told something is kept back, not what
    // Leo is still out
    await speakAs(ctx.store, ctx.hh, 'leo', 'pin');
    expect((await requestAction(ctx.deps, ctx.hh, ask('order_history'))).outcome).toBe('denied');
  });

  it('even if an adult opens orders to children, a child never hears a gift', async () => {
    const ctx = await newHousehold();
    const { people, rules } = await loadHousehold(ctx.store, ctx.hh);
    const a = applyChange(rules, { template: 'private_orders', roles: ['teen', 'child'] }, people);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    await ctx.store.put({ pk: Store.hk(ctx.hh), sk: 'RULES#current', config: a.config });
    await speakAs(ctx.store, ctx.hh, 'leo', 'pin');
    const r = await requestAction(ctx.deps, ctx.hh, ask('cart'));
    expect(r.outcome).toBe('allowed');
    expect(JSON.stringify(r)).not.toMatch(ITEMS);
  });

  it('the card refuses guests and bad input, and shows on the rules screen', () => {
    const rules = defaultRules();
    const people = [{ id: 'mom', name: 'Mom', role: 'adult' as const, hasPhone: true }];
    expect(applyChange(rules, { template: 'private_orders', roles: ['guest' as never] }, people).ok).toBe(false);
    expect(applyChange(rules, { template: 'private_orders', roles: 'x' as never }, people).ok).toBe(false);
    expect(rulesHtml(rules, people)).toMatch(/Only adults hear orders/);
    const ok = applyChange(rules, { template: 'private_orders', roles: [] }, people);
    expect(ok.ok && ok.sentence).toMatch(/Only adults/);
  });

  it('a forced storage failure holds, never leaks', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const orig = ctx.store.query.bind(ctx.store);
    ctx.store.query = (async (pk: string, p: string, o?: never) => {
      if (p.startsWith('ORDER#') || p.startsWith('CART#')) throw new Error('boom');
      return orig(pk, p, o);
    }) as typeof ctx.store.query;
    const r = await requestAction(ctx.deps, ctx.hh, ask('order_history'));
    expect(r.outcome).toBe('held');
    expect(r.done).toBe(false);
  });
});

describe('S19 replay', () => {
  it('the replay suite is 34 cases: 30 up to S7, and 4 for private orders', async () => {
    const { CASES } = await import('../replay/cases.js');
    expect(CASES).toHaveLength(34);
    expect(CASES.filter((c) => c.slice === 19)).toHaveLength(4);
  });
});
