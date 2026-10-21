import { describe, expect, it } from 'vitest';
import { newHousehold, speakAs } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';
import { proposeRule, myRules, rulesHtml } from '../../src/rules/change.js';
import { phoneConfirm, phoneInbox } from '../../src/identity/confirm.js';
import { getChallenge } from '../../src/approvals/challenge.js';
import { readAudit, verifyAudit } from '../../src/audit/audit.js';
import { applyChange } from '../../src/rules/templates.js';
import { defaultRules } from '../../src/policy/rules.js';
import { loadHousehold } from '../../src/core/household.js';
import { Store } from '../../src/core/store.js';
import { CASES } from '../replay/cases.js';

type Ctx = Awaited<ReturnType<typeof newHousehold>>;
const ride = (to: string, extra: Record<string, unknown> = {}) => ({ service: 'mock-ride', action: 'purchase', item: `ride to the ${to}`, ...extra });
const limit = (person: string, dollars: number) => ({ change: { template: 'weekly_limit' as const, person, cents: dollars * 100 } });

async function tapFor(ctx: Ctx, who: 'mom' | 'maya', id: string) {
  const c = (await getChallenge(ctx.deps, ctx.hh, id))!;
  return phoneConfirm(ctx.deps, ctx.hh, who, { challenge_id: c.id, number: c.number });
}
async function change(ctx: Ctx, req: Parameters<typeof proposeRule>[2]) {
  const r = await proposeRule(ctx.deps, ctx.hh, req);
  expect(r.status).toBe('waiting');
  const t = await tapFor(ctx, 'mom', r.challenge_id!);
  return { r, t };
}

describe('S7 editable rules', () => {
  it('Mom changes Maya\'s limit; her phone shows the change; the NEXT decision follows it', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya');
    expect((await requestAction(ctx.deps, ctx.hh, ride('airport', { option_id: 'economy' }))).outcome).toBe('held'); // $24 > $20
    await speakAs(ctx.store, ctx.hh, 'mom');
    const r = await proposeRule(ctx.deps, ctx.hh, limit('maya', 30));
    expect(r).toMatchObject({ status: 'waiting', sentence: "Maya's limit goes from $20 to $30 a week.", warning: 'This lets Maya spend $10 more a week.' });
    expect((await phoneInbox(ctx.deps, ctx.hh, 'mom')).challenges[0].text).toContain("Maya's limit goes from $20 to $30 a week.");
    expect((await loadHousehold(ctx.store, ctx.hh)).rules.weeklyCapCents.maya).toBe(2000); // nothing saved before the tap
    expect((await tapFor(ctx, 'mom', r.challenge_id!)).status).toBe('confirmed');
    const { rules } = await loadHousehold(ctx.store, ctx.hh);
    expect(rules).toMatchObject({ version: 2, weeklyCapCents: { maya: 3000 } });
    await speakAs(ctx.store, ctx.hh, 'maya');
    expect((await requestAction(ctx.deps, ctx.hh, ride('airport', { option_id: 'economy' }))).outcome).toBe('allowed');
    expect((await ctx.store.get(Store.hk(ctx.hh), 'RULES#v2'))?.config.version).toBe(2); // versioned
    expect((await readAudit(ctx.store, ctx.hh)).some((e) => e.category === 'rule' && /^Mom changed a rule at .* Maya's limit goes from \$20 to \$30 a week\.$/.test(e.text))).toBe(true);
    expect((await verifyAudit(ctx.store, ctx.hh)).ok).toBe(true);
  });

  it('a teen\'s attempt to change a rule is denied, nothing saved, and it is in the log', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya');
    const r = await proposeRule(ctx.deps, ctx.hh, limit('maya', 500));
    expect(r).toMatchObject({ status: 'denied', say: 'Ask an adult to change rules.' });
    expect((await phoneInbox(ctx.deps, ctx.hh, 'mom')).challenges).toEqual([]);
    expect((await loadHousehold(ctx.store, ctx.hh)).rules.version).toBe(1);
    expect((await readAudit(ctx.store, ctx.hh)).some((e) => /^Maya tried to change a rule at .* No\. Only adults can\.$/.test(e.text))).toBe(true);
  });

  it('a guest, a PIN-only adult, and a stolen tap cannot change rules', async () => {
    const ctx = await newHousehold();
    expect((await proposeRule(ctx.deps, ctx.hh, limit('maya', 500))).say).toBe('Tell me who you are first.');
    await speakAs(ctx.store, ctx.hh, 'mom', 'pin');
    expect((await proposeRule(ctx.deps, ctx.hh, limit('maya', 500))).say).toBe('Confirm on your phone first.');
    await speakAs(ctx.store, ctx.hh, 'mom');
    const r = await proposeRule(ctx.deps, ctx.hh, limit('maya', 500));
    expect((await tapFor(ctx, 'maya', r.challenge_id!)).status).toBe('not_yours');
    expect((await loadHousehold(ctx.store, ctx.hh)).rules.version).toBe(1);
  });

  it('undo restores the old rule (one more tap), only the newest change, only for 24 hours', async () => {
    let t = Date.now();
    const ctx = await newHousehold({ now: () => t });
    // (3 confirmation pushes per 10 minutes is the limit, so each step happens 11 minutes after the last)
    const again = async () => { t += 11 * 60_000; await speakAs(ctx.store, ctx.hh, 'mom', 'phone', t); };
    await again();
    await change(ctx, limit('maya', 30));
    await again();
    await change(ctx, { change: { template: 'allowed_apps', services: ['mock-ride', 'sim-home'] } });
    await again();
    const u = await change(ctx, { undo: true });
    expect(u.t.say).toMatch(/^Undone: Allowed apps/);
    let rules = (await loadHousehold(ctx.store, ctx.hh)).rules;
    expect(rules.allowedServices).toContain('mock-shop');
    expect(rules.weeklyCapCents.maya).toBe(3000); // the older change is still in place
    expect(rules.version).toBe(4);
    await again();
    await change(ctx, { undo: true }); // now the newest applied is the limit change
    rules = (await loadHousehold(ctx.store, ctx.hh)).rules;
    expect(rules.weeklyCapCents.maya).toBe(2000);
    expect((await proposeRule(ctx.deps, ctx.hh, { undo: true })).say).toBe('Nothing to undo.');
    await again();
    await change(ctx, limit('maya', 25));
    t += 25 * 3600_000;
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone', t);
    expect((await proposeRule(ctx.deps, ctx.hh, { undo: true })).say).toBe('That is too old to undo.');
  });

  it('the two locked rules need a warning and a second tap', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom');
    const r = await proposeRule(ctx.deps, ctx.hh, { change: { template: 'floor', which: 'childrenNoUnlock', enabled: false } });
    expect(r.warning).toBe('This lets a child unlock the front door.');
    const first = await tapFor(ctx, 'mom', r.challenge_id!);
    expect(first.result).toMatchObject({ done: false });
    expect(first.say).toMatch(/This lets a child unlock the front door\. Confirm on your phone: \d\d/);
    expect((await loadHousehold(ctx.store, ctx.hh)).rules.floor.childrenNoUnlock).toBe(true); // one tap is not enough
    const second = await tapFor(ctx, 'mom', first.result!.jobId!);
    expect(second.result).toMatchObject({ done: true, reason: "Rule off: children can't unlock doors." });
    expect((await loadHousehold(ctx.store, ctx.hh)).rules.floor.childrenNoUnlock).toBe(false);
  });

  it('bad changes are refused before anything is saved', async () => {
    const ctx = await newHousehold();
    const { people: ppl } = await loadHousehold(ctx.store, ctx.hh);
    const base = defaultRules();
    for (const bad of [
      { template: 'weekly_limit', person: 'maya', cents: -5 },
      { template: 'weekly_limit', person: 'maya', cents: 1.5 },
      { template: 'weekly_limit', person: 'maya', cents: 99_999_999 },
      { template: 'weekly_limit', person: 'nobody', cents: 100 },
      { template: 'weekly_limit', person: 'guest', cents: 100 },
      { template: 'adults_only', actions: ['purchase'] },
      { template: 'adults_only', actions: ['rm -rf'] },
      { template: 'allowed_apps', services: ['<script>'] },
      { template: 'must_haves', arriveByHour: 99 },
      { template: 'floor', which: 'everything', enabled: false },
      { template: 'nonsense' },
    ] as any[]) expect(applyChange(base, bad, ppl).ok, JSON.stringify(bad)).toBe(false);
    expect(applyChange(base, { template: 'weekly_limit', person: 'maya', cents: 3000 }, ppl).ok).toBe(true);
  });

  it('kids can see their own rules, not change them', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya');
    expect((await myRules(ctx.deps, ctx.hh)).say).toBe('My limit: $20 a week, $20 left. Some things are for adults only.');
    const r = await requestAction(ctx.deps, ctx.hh, ride('mall'));
    await tapFor(ctx, 'maya' as any, r.job_id as string);
    await ctx.queue.drain();
    expect((await myRules(ctx.deps, ctx.hh)).say).toBe('My limit: $20 a week, $5 left. Some things are for adults only.');
    await speakAs(ctx.store, ctx.hh, 'leo', 'pin');
    expect((await myRules(ctx.deps, ctx.hh)).say).toBe('I need an adult to say yes to buys. Some things are for adults only.');
    await ctx.store.delete(Store.hk(ctx.hh), 'SESSION#current');
    expect((await myRules(ctx.deps, ctx.hh)).say).toBe('Tell me who you are first.');
  });

  it('the rule cards screen shows plain rules and marks the locked ones', async () => {
    const ctx = await newHousehold();
    const h = await loadHousehold(ctx.store, ctx.hh);
    const html = rulesHtml(h.rules, h.people);
    expect(html).toContain('Maya: $20 a week.');
    expect(html).toContain('Locked: children can&#39;t unlock doors.');
    expect(html).toContain('Locked: guests can&#39;t buy.');
    expect(html).not.toMatch(/cedar|policy|permit|forbid/i);
  });

  it('two edits at the same moment: one wins, the other is told to try again', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom');
    const a = await proposeRule(ctx.deps, ctx.hh, limit('maya', 30));
    const b = await proposeRule(ctx.deps, ctx.hh, limit('maya', 40));
    const out = await Promise.all([tapFor(ctx, 'mom', a.challenge_id!), tapFor(ctx, 'mom', b.challenge_id!)]);
    expect(out.filter((o) => o.result?.done).length).toBe(1);
    expect(out.some((o) => o.result?.reason === 'The rules changed. Try again.')).toBe(true);
  });
});

describe('S7 full replay', () => {
  it('the replay suite has 30 cases', () => {
    expect(CASES).toHaveLength(30);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(30);
  });
});

describe('S7 review fixes', () => {
  it('undoing a change that had turned a locked rule back ON needs the warning and a second tap', async () => {
    let t = Date.now();
    const ctx = await newHousehold({ now: () => t });
    const again = async () => { t += 11 * 60_000; await speakAs(ctx.store, ctx.hh, 'mom', 'phone', t); };
    // start from a house where the locked rule is already off, then turn it on, then undo that
    await ctx.store.put({ pk: Store.hk(ctx.hh), sk: 'RULES#current', config: { ...defaultRules(), floor: { childrenNoUnlock: false, guestsNoBuy: true } } });
    await again();
    await change(ctx, { change: { template: 'floor', which: 'childrenNoUnlock', enabled: true } });
    await again();
    const r = await proposeRule(ctx.deps, ctx.hh, { undo: true });
    expect(r.warning).toBe('This turns off a locked rule.');
    const first = await tapFor(ctx, 'mom', r.challenge_id!);
    expect(first.result).toMatchObject({ done: false });
    expect((await loadHousehold(ctx.store, ctx.hh)).rules.floor.childrenNoUnlock).toBe(true); // one tap is not enough
    expect((await tapFor(ctx, 'mom', first.result!.jobId!)).result).toMatchObject({ done: true });
    expect((await loadHousehold(ctx.store, ctx.hh)).rules.floor.childrenNoUnlock).toBe(false);
  });
  it('refused attempts by a guest or a PIN-only adult are in the log too', async () => {
    const ctx = await newHousehold();
    await proposeRule(ctx.deps, ctx.hh, limit('maya', 500));
    await speakAs(ctx.store, ctx.hh, 'mom', 'pin');
    await proposeRule(ctx.deps, ctx.hh, limit('maya', 500));
    const t = (await readAudit(ctx.store, ctx.hh)).map((e) => e.text).join('\n');
    expect(t).toMatch(/Someone tried to change a rule at .* Nobody was confirmed\./);
    expect(t).toMatch(/Mom tried to change a rule at .* Needs their phone first\./);
  });
  it('the change record is saved with the rule, so it can always be undone', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom');
    await change(ctx, limit('maya', 30));
    expect((await ctx.store.query(Store.hk(ctx.hh), 'RULECHG#')).map((r) => r.status)).toEqual(['applied']);
  });
});

describe('S7 safety floor ships locked on a fresh house', () => {
  it('"children can\'t unlock doors" and "guests can\'t buy" are on by default', async () => {
    const { defaultRules } = await import('../../src/policy/rules.js');
    expect(defaultRules().floor).toEqual({ childrenNoUnlock: true, guestsNoBuy: true });
    const ctx = await newHousehold();
    const { loadHousehold } = await import('../../src/core/household.js');
    expect((await loadHousehold(ctx.store, ctx.hh)).rules.floor).toEqual({ childrenNoUnlock: true, guestsNoBuy: true });
  });
});
