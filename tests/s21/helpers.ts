import { newHousehold } from '../helpers.js';
import { Store } from '../../src/core/store.js';
import { loadHousehold } from '../../src/core/household.js';

// Grandma is a second adult with a phone. (The demo page adds her with /demo/grandma; tests add her here.)
export async function addGrandma(ctx: Awaited<ReturnType<typeof newHousehold>>) {
  const pk = Store.hk(ctx.hh);
  await ctx.store.put({ pk, sk: 'PERSON#grandma', id: 'grandma', name: 'Grandma', role: 'adult', hasPhone: true });
  const { rules } = await loadHousehold(ctx.store, ctx.hh);
  await ctx.store.put({ pk, sk: 'RULES#current', config: { ...rules, weeklyCapCents: { ...rules.weeklyCapCents, grandma: 50000 }, perRequestCapCents: { ...rules.perRequestCapCents, grandma: 20000 } } });
}
