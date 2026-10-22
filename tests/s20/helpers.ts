import { newHousehold } from '../helpers.js';
import { phoneConfirm } from '../../src/identity/confirm.js';
import { getChallenge } from '../../src/approvals/challenge.js';

export type Ctx = Awaited<ReturnType<typeof newHousehold>>;

// A tap on someone's own phone, the way the phone page does it: find the open question and tap the real number.
export async function tap(ctx: Ctx, who: string, challengeId: string) {
  const c = (await getChallenge(ctx.deps, ctx.hh, challengeId))!;
  return phoneConfirm(ctx.deps, ctx.hh, who, { challenge_id: c.id, number: c.number });
}

export const ride = (where: string, option = 'standard') => ({ service: 'mock-ride', action: 'purchase', item: `ride to the ${where}`, option_id: option });
export const home = (action: string, item?: string, value?: string | number) => ({ service: 'sim-home', action, ...(item ? { item } : {}), ...(value !== undefined ? { value } : {}) });
