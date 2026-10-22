import { describe, expect, it } from 'vitest';
import { newHousehold, speakAs } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';
import { proposeRule } from '../../src/rules/change.js';
import { phoneInbox } from '../../src/identity/confirm.js';
import { readAudit } from '../../src/audit/audit.js';
import { cardsOf } from '../../src/mcp/apps.js';
import { openApprovals } from '../../src/approvals/approvals.js';
import { home, ride, tap } from './helpers.js';

const GIFTS = /lego|castle|soccer/i;
const shop = (action: string, item?: string, value?: string) => ({ service: 'mock-shop', action, ...(item ? { item } : {}), ...(value ? { value } : {}) });

describe('private things stay private', () => {
  it('Leo asks "what did we order" and hears nothing about the gift (nor any item), in the reply or the log', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'leo', 'pin');
    for (const a of ['order_history', 'order_status', 'cart']) {
      const r = await requestAction(ctx.deps, ctx.hh, shop(a));
      expect(r.outcome).toBe('denied');
      expect(r.say).toBe("That's private. Ask a grown-up.");
      expect(JSON.stringify(r)).not.toMatch(GIFTS);
    }
    expect(JSON.stringify(await readAudit(ctx.store, ctx.hh))).not.toMatch(GIFTS);
  });
  it('Mom marks an order a gift; from then on even a card that opens orders to children never says it', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const open = await proposeRule(ctx.deps, ctx.hh, { change: { template: 'private_orders', roles: ['child'] } });
    await tap(ctx, 'mom', open.challenge_id!);
    // before: Leo may hear "paper towels"
    await speakAs(ctx.store, ctx.hh, 'leo', 'pin');
    expect((await requestAction(ctx.deps, ctx.hh, shop('order_history'))).say).toMatch(/paper towels/);
    // Mom marks it a gift
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const m = await requestAction(ctx.deps, ctx.hh, shop('mark_gift', 'paper towels', 'Leo'));
    expect(m).toMatchObject({ outcome: 'allowed', done: true });
    expect(m.say).toBe('Okay. It is marked as a gift. Only adults hear it.');
    expect((await requestAction(ctx.deps, ctx.hh, shop('order_history'))).say).toMatch(/paper towels \(a gift for Leo\)/); // an adult still hears it
    await speakAs(ctx.store, ctx.hh, 'leo', 'pin');
    const leo = await requestAction(ctx.deps, ctx.hh, shop('order_history'));
    expect(leo.say).not.toMatch(/paper towels|lego|castle/i);
    expect(leo.say).toMatch(/Some are private\./);
    expect(JSON.stringify(await readAudit(ctx.store, ctx.hh))).not.toMatch(/paper towels|lego|castle/i);
  });
  it('only an adult can mark a gift; an unknown order finds nothing; a short word is refused', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    expect((await requestAction(ctx.deps, ctx.hh, shop('mark_gift', 'phone charger'))).outcome).toBe('denied');
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    expect((await requestAction(ctx.deps, ctx.hh, shop('mark_gift', 'a pony'))).say).toBe("I couldn't find that order.");
    expect((await requestAction(ctx.deps, ctx.hh, shop('mark_gift', 'a'))).outcome).toBe('denied');
  });
});

describe('why? every answer can say which rule decided', () => {
  it('after a held ride: "Because of this rule: Maya\'s $20 a week."', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    await requestAction(ctx.deps, ctx.hh, ride('airport'));
    const w = await requestAction(ctx.deps, ctx.hh, home('why'));
    expect(w).toMatchObject({ outcome: 'allowed', done: true });
    expect(w.say).toBe("Because of this rule: Maya's $20 a week.");
  });
  it('after a refusal, an allowed light, and an unlock: one sentence each, naming the rule', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'leo', 'pin');
    await requestAction(ctx.deps, ctx.hh, home('unlock', 'front door'));
    expect((await requestAction(ctx.deps, ctx.hh, home('why'))).say).toMatch(/^Because of this rule: (children can't unlock doors|only adults unlock doors)\.$/);
    await requestAction(ctx.deps, ctx.hh, home('light', 'lights', 'on'));
    expect((await requestAction(ctx.deps, ctx.hh, home('why'))).say).toBe('Because of this rule: lights are open to all.');
    await requestAction(ctx.deps, ctx.hh, shop('order_history'));
    expect((await requestAction(ctx.deps, ctx.hh, home('why'))).say).toBe('Because of this rule: orders are private.');
  });
  it('asking why is not itself remembered or logged, so "why?" twice gives the same answer', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    await requestAction(ctx.deps, ctx.hh, home('light', 'lights', 'on'));
    const n = (await readAudit(ctx.store, ctx.hh)).length;
    const a = await requestAction(ctx.deps, ctx.hh, home('why'));
    const b = await requestAction(ctx.deps, ctx.hh, home('why'));
    expect(a.say).toBe(b.say);
    expect((await readAudit(ctx.store, ctx.hh)).length).toBe(n);
  });
  it('it is each person\'s own last answer, and it says so plainly when there is none', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    await requestAction(ctx.deps, ctx.hh, ride('airport'));
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    expect((await requestAction(ctx.deps, ctx.hh, home('why'))).say).toBe('I have not said no or yes to you yet.');
  });
  it('the approval card (on the adult\'s phone and on the screen) carries the rule, and a Why? answer', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    await requestAction(ctx.deps, ctx.hh, ride('airport'));
    const inbox = await phoneInbox(ctx.deps, ctx.hh, 'mom');
    expect(inbox.approvals[0].rule).toBe("Because of this rule: Maya's $20 a week.");
    expect(cardsOf(await openApprovals(ctx.deps, ctx.hh), true)[0].rule).toBe("Rule: Maya's $20 a week.");
  });
  it('the reply to every decision also carries the rule line (the audit sentence ends with it)', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    const r = await requestAction(ctx.deps, ctx.hh, home('light', 'lights', 'off'));
    expect(r.rule).toBe('Rule: lights are open to all.');
    expect((await readAudit(ctx.store, ctx.hh))[0].text).toMatch(/Rule: lights are open to all\.$/);
  });
});
