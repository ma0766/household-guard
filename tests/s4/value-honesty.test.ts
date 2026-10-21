import { describe, expect, it } from 'vitest';
import { newHousehold, speakAs } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';
import { Store } from '../../src/core/store.js';
import { defaultRules } from '../../src/policy/rules.js';

const airport = { service: 'mock-ride', action: 'purchase', item: 'ride to the airport' };
const rules = { ...defaultRules(), weeklyCapCents: { mom: 50000, maya: 3000 }, perRequestCapCents: { mom: 20000, maya: 3000 } };

describe('S4 must-haves: "arrives by 6 PM"', () => {
  it('the cheapest option that arrives late is skipped; the next cheapest that arrives in time is offered', async () => {
    const at = Date.parse('2026-10-20T21:30:00Z'); // 5:30 PM in New York
    const ctx = await newHousehold({ now: () => at });
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone', at);
    await ctx.store.put({ pk: Store.hk(ctx.hh), sk: 'RULES#current', config: rules });
    // no must-have: the shared ride ($14, 40 minutes) wins
    expect((await requestAction(ctx.deps, ctx.hh, airport)).alternative).toMatchObject({ option_id: 'shared', total_cents: 1400 });
    // arrive by 6 PM: shared would land at 6:10 PM, so the economy ride ($24, 25 minutes) is offered
    await ctx.store.put({ pk: Store.hk(ctx.hh), sk: 'RULES#current', config: { ...rules, mustHaves: { arriveByHour: 18 } } });
    expect((await requestAction(ctx.deps, ctx.hh, airport)).alternative).toMatchObject({ option_id: 'economy', total_cents: 2400 });
    // arrive by 5 PM: it is already 5:30, so nothing qualifies and no offer is made
    await ctx.store.put({ pk: Store.hk(ctx.hh), sk: 'RULES#current', config: { ...rules, mustHaves: { arriveByHour: 17 } } });
    expect((await requestAction(ctx.deps, ctx.hh, airport)).alternative).toBeUndefined();
  });
});

describe('S4 honesty rule', () => {
  it('says "the lowest price we found", never "cheapest anywhere", in any answer', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya');
    const r = await requestAction(ctx.deps, ctx.hh, airport);
    const spoken = JSON.stringify([r.say, r.reason, r.alternative]);
    expect(spoken).not.toMatch(/cheapest|best price|anywhere|lowest price (anywhere|on)/i);
    expect(r.alternative).toBeTruthy();
    expect((r.alternative as any).note).toBe('The lowest price we found, from the rides we checked.');
  });
});
