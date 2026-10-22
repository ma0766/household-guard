import { describe, expect, it } from 'vitest';
import { newHousehold, speakAs } from '../helpers.js';
import { proposeRule } from '../../src/rules/change.js';
import { phoneConfirm } from '../../src/identity/confirm.js';
import { getChallenge } from '../../src/approvals/challenge.js';
import { loadHousehold } from '../../src/core/household.js';
import { requestAction } from '../../src/core/request-action.js';
import { decide, decideWith } from '../../src/policy/evaluator.js';
import { defaultRules, generatePolicies } from '../../src/policy/rules.js';

// A limit is ONE setting per person and every restriction is a forbid: a newer, looser permit can never override it.
const buy = (amountCents: number, weekSpentCents = 0) => ({ person: { id: 'maya', role: 'teen' as const }, action: 'purchase', service: 'mock-ride', serviceKnown: true, amountCents, weekSpentCents, value: 0, session: 'phone' as const, localHour: 12 });
const mayaRules = (sets: Record<string, string>) => Object.entries(sets).filter(([, t]) => /^(forbid|permit)\(principal == Person::"maya"/.test(t) && t.includes('"purchase"'));

describe('limits are single settings; restrictions are forbids', () => {
  it('Maya has exactly one limit rule, and it is a forbid; the other restrictions are forbids too', () => {
    const sets = generatePolicies(defaultRules());
    const own = mayaRules(sets.auto);
    expect(own).toHaveLength(1);
    expect(own[0][1].startsWith('forbid(')).toBe(true);
    // no permit anywhere carries a limit in its condition
    for (const t of [...Object.values(sets.auto), ...Object.values(sets.approvable)]) if (t.startsWith('permit(')) expect(t, t).not.toMatch(/amount_cents|week_spent|context\.value|service_known|session/);
  });

  it('a stray newer permit for Maya cannot loosen the limit: a $35 buy with $20 set is still held', () => {
    const sets = generatePolicies(defaultRules());
    sets.auto.newer_looser_permit = 'permit(principal == Person::"maya", action == Action::"purchase", resource);';
    sets.auto.another = 'permit(principal in Role::"teen", action == Action::"purchase", resource) when { context.amount_cents <= 5000 };';
    const d = decideWith(sets, buy(3500));
    expect(d.answer).toBe('hold');
    expect(d.blockedBy).toContain('cap_maya');
    // and within the limit it still goes through
    expect(decideWith(sets, buy(1500)).answer).toBe('allow');
  });

  it('a $50 attempt REPLACES the $20 limit, never stacks; until Mom taps, a $35 buy still holds; undo brings $20 back', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const r = await proposeRule(ctx.deps, ctx.hh, { change: { template: 'weekly_limit', person: 'maya', cents: 5000 } });
    expect(r.status).toBe('waiting');
    expect(r.warning).toMatch(/\$30 more/); // the looser attempt says so before anything is saved
    let h = await loadHousehold(ctx.store, ctx.hh);
    expect(h.rules.weeklyCapCents.maya).toBe(2000); // nothing saved yet
    expect(decide(h.rules, buy(3500)).answer).toBe('hold');

    const tap = async (id: string) => { const c = (await getChallenge(ctx.deps, ctx.hh, id))!; return phoneConfirm(ctx.deps, ctx.hh, 'mom', { challenge_id: c.id, number: c.number }); };
    expect((await tap(r.challenge_id!)).result?.done).toBe(true);
    h = await loadHousehold(ctx.store, ctx.hh);
    expect(h.rules.weeklyCapCents.maya).toBe(5000);
    expect(mayaRules(generatePolicies(h.rules).auto)).toHaveLength(1); // replaced, not stacked
    expect(decide(h.rules, buy(3500)).answer).toBe('allow');

    const u = await proposeRule(ctx.deps, ctx.hh, { undo: true });
    expect(u.status).toBe('waiting');
    expect((await tap(u.challenge_id!)).result?.done).toBe(true);
    h = await loadHousehold(ctx.store, ctx.hh);
    expect(h.rules.weeklyCapCents.maya).toBe(2000);
    expect(mayaRules(generatePolicies(h.rules).auto)).toHaveLength(1);
    expect(decide(h.rules, buy(3500)).answer).toBe('hold');
  });

  it('through the real door: with $20 set, the $38 ride is held for an adult', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    const r = await requestAction(ctx.deps, ctx.hh, { service: 'mock-ride', action: 'purchase', item: 'ride to the airport' });
    expect(r.outcome).toBe('held');
  });
});

describe('the audit sentence names the rule that decided', () => {
  it('held by the limit, denied by a locked rule, done by an open one, private orders', async () => {
    const { readAudit } = await import('../../src/audit/audit.js');
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    await requestAction(ctx.deps, ctx.hh, { service: 'mock-ride', action: 'purchase', item: 'ride to the airport' });
    await requestAction(ctx.deps, ctx.hh, { service: 'sim-home', action: 'unlock', item: 'front door' });
    await requestAction(ctx.deps, ctx.hh, { service: 'sim-home', action: 'light', item: 'lights', value: 'off' });
    await requestAction(ctx.deps, ctx.hh, { service: 'mock-shop', action: 'order_history' });
    const t = (await readAudit(ctx.store, ctx.hh)).map((e) => e.text).join('\n');
    expect(t).toMatch(/\$38 ride at .*Held: over Maya's \$20 a week\. Rule: Maya's \$20 a week\./);
    expect(t).toMatch(/unlock the front door at .*No\. .* Rule: (children can't unlock doors|only adults unlock doors)\./);
    expect(t).toMatch(/lights off at .*Rule: lights are open to all\./);
    expect(t).toMatch(/hear about orders at .*No\. That's private\. Ask a grown-up\. Rule: orders are private\./);
    for (const line of t.split('\n')) expect(line.length, line).toBeLessThanOrEqual(240);
  });
});
