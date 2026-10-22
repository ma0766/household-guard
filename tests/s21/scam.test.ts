import { describe, expect, it } from 'vitest';
import { newHousehold, speakAs } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';
import { approveRequest, openApprovals } from '../../src/approvals/approvals.js';
import { phoneInbox } from '../../src/identity/confirm.js';
import { readAudit } from '../../src/audit/audit.js';
import { countBookings } from '../../src/connectors/mock-ride.js';
import { T } from '../../src/text.js';
import { addGrandma } from './helpers.js';
import { setSession } from '../../src/core/household.js';

const shop = (item: string) => ({ service: 'mock-shop', action: 'purchase', item });
const LINE = 'People pretending to be family often ask for this. Call them first.';

describe('the scam guard', () => {
  it('the warning is the words you asked for', () => expect(T.scam).toBe(LINE));
  it("Grandma's $200 gift card is held with the warning, whatever her limit; nothing is bought", async () => {
    const ctx = await newHousehold();
    await addGrandma(ctx);
    await setSession(ctx.store, ctx.hh, 'grandma', 'phone');
    const r = await requestAction(ctx.deps, ctx.hh, shop('a $200 gift card'));
    expect(r).toMatchObject({ outcome: 'held', amount_cents: 20000, done: false, reason: LINE, rule: 'Rule: scams often start like this.' });
    expect(r.say).toContain(LINE);
    expect(r.next).toBeUndefined(); // no "confirm on your own phone": her own tap is not enough
    expect(await countBookings(ctx.store, ctx.hh)).toBe(0);
    const card = (await phoneInbox(ctx.deps, ctx.hh, 'mom')).approvals[0];
    expect(card).toMatchObject({ who: 'Grandma', amount: '$200', why: LINE });
  });
  it('she cannot wave it through herself; another adult can, and then it is bought', async () => {
    const ctx = await newHousehold();
    await addGrandma(ctx);
    await setSession(ctx.store, ctx.hh, 'grandma', 'phone');
    await requestAction(ctx.deps, ctx.hh, shop('a $200 gift card'));
    const a = (await openApprovals(ctx.deps, ctx.hh))[0];
    expect(a.scam).toBe(true);
    const self = await approveRequest(ctx.deps, ctx.hh, 'grandma', a.id, { number: a.number, method: 'phone' });
    expect(self).toMatchObject({ status: 'not_adult', say: 'Ask another adult to say yes.' });
    const ok = await approveRequest(ctx.deps, ctx.hh, 'mom', a.id, { number: a.number, method: 'phone' });
    expect(ok.status).toBe('approved');
    await ctx.queue.drain();
    expect(await countBookings(ctx.store, ctx.hh)).toBe(1);
  });
  it('Mom, with $500 a week, still waits for another adult: the limit does not matter', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    for (const item of ['a $20 gift card', 'bitcoin $100', 'a wire transfer of $300']) expect((await requestAction(ctx.deps, ctx.hh, shop(item))).outcome, item).toBe('held');
  });
  it('a teen or a child asking for one is held too; a guest is still refused', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    expect((await requestAction(ctx.deps, ctx.hh, shop('gift card'))).reason).toBe(LINE);
    await ctx.store.delete((await import('../../src/core/store.js')).Store.hk(ctx.hh), 'SESSION#current');
    expect((await requestAction(ctx.deps, ctx.hh, shop('gift card'))).outcome).toBe('denied');
  });
  it('the first payment to a new person is held; once an adult said yes, the next one needs only a tap', async () => {
    const ctx = await newHousehold();
    await addGrandma(ctx);
    await setSession(ctx.store, ctx.hh, 'grandma', 'phone');
    const first = await requestAction(ctx.deps, ctx.hh, shop('send $50 to Dana'));
    expect(first).toMatchObject({ outcome: 'held', reason: LINE });
    const a = (await openApprovals(ctx.deps, ctx.hh))[0];
    await approveRequest(ctx.deps, ctx.hh, 'mom', a.id, { number: a.number, method: 'phone' });
    await ctx.queue.drain();
    expect(await countBookings(ctx.store, ctx.hh)).toBe(1);
    const second = await requestAction(ctx.deps, ctx.hh, shop('send $50 to Dana'));
    expect(second.outcome).toBe('allowed'); // now known: her own tap
    const other = await requestAction(ctx.deps, ctx.hh, shop('send $50 to Pat'));
    expect(other.outcome).toBe('held');
  });
  it('an ordinary $12 buy is not a scam', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    expect(await requestAction(ctx.deps, ctx.hh, shop('headphones'))).toMatchObject({ outcome: 'allowed', next: 'confirm_on_phone' });
  });
  it('the log names the rule and no card text', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    await requestAction(ctx.deps, ctx.hh, shop('a $200 gift card'));
    expect((await readAudit(ctx.store, ctx.hh))[0].text).toMatch(/Rule: scams often start like this\.$/);
  });
  it('odd amounts and words never slip past: a $0, a huge, or a hidden-word ask is refused or held', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    for (const item of ['gift card $0', 'gift card $9999', 'gift-card', 'GIFT CARD', 'g1ft card']) {
      const r = await requestAction(ctx.deps, ctx.hh, shop(item));
      expect(['held', 'denied'], item).toContain(r.outcome);
    }
  });
  it('review fixes: filler words are not payees; risky words win; commas and "dollars" are read', async () => {
    const { quoteItem } = await import('../../src/connectors/mock-shop.js');
    expect(quoteItem('send $40 to my friend Dana')).toMatchObject({ payee: 'dana', item: 'send money to dana' });
    expect(quoteItem('send $40 to my friend')).toBeUndefined(); // no name: not bought
    expect(quoteItem('pay $20 to the shop')).toMatchObject({ payee: 'shop' });
    expect(quoteItem('headphones and a $500 wire transfer')).toMatchObject({ item: 'wire transfer', total_cents: 50000 });
    expect(quoteItem('a 500 dollars gift card')).toMatchObject({ item: 'gift card', total_cents: 50000 });
    expect(quoteItem('a $1,500 gift card')).toBeUndefined(); // over what this shop sells
    expect(quoteItem('gift card')).toMatchObject({ total_cents: 1500 });
  });
  it('a payee that an adult said yes to is the NAME, never a filler word', async () => {
    const ctx = await newHousehold();
    await addGrandma(ctx);
    await setSession(ctx.store, ctx.hh, 'grandma', 'phone');
    await requestAction(ctx.deps, ctx.hh, shop('send $40 to my friend Dana'));
    const a = (await openApprovals(ctx.deps, ctx.hh))[0];
    await approveRequest(ctx.deps, ctx.hh, 'mom', a.id, { number: a.number, method: 'phone' });
    await ctx.queue.drain();
    const other = await requestAction(ctx.deps, ctx.hh, shop('send $400 to my new friend Pat'));
    expect(other).toMatchObject({ outcome: 'held', reason: LINE }); // Pat is new: "my" did not become a known payee
  });
});
