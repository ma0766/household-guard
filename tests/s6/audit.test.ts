import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { newHousehold, speakAs } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';
import { appendAudit, readAudit, verifyAudit } from '../../src/audit/audit.js';
import { approveRequest, getApproval } from '../../src/approvals/approvals.js';
import { phoneConfirm } from '../../src/identity/confirm.js';
import { getChallenge } from '../../src/approvals/challenge.js';
import { voiceSummary, householdStatus } from '../../src/audit/report.js';
import { approvalsHtml, timelineHtml } from '../../src/audit/views.js';
import { Store } from '../../src/core/store.js';
import { BANNED_WORDS } from '../../src/text.js';
import { confirmIdentity } from '../../src/identity/confirm.js';

const ride = (to: string, extra: Record<string, unknown> = {}) => ({ service: 'mock-ride', action: 'purchase', item: `ride to the ${to}`, ...extra });
type Ctx = Awaited<ReturnType<typeof newHousehold>>;
const tz = 'America/New_York';
const texts = async (c: Ctx) => (await readAudit(c.store, c.hh, { limit: 100 })).reverse().map((e) => e.text);

async function tap(ctx: Ctx, who: 'maya' | 'mom', id: string) {
  const c = (await getChallenge(ctx.deps, ctx.hh, id))!;
  return phoneConfirm(ctx.deps, ctx.hh, who, { challenge_id: c.id, number: c.number });
}
async function savedStory(ctx: Ctx) {
  await speakAs(ctx.store, ctx.hh, 'maya');
  const held = await requestAction(ctx.deps, ctx.hh, ride('airport'));
  const yes = await requestAction(ctx.deps, ctx.hh, ride('airport', { option_id: 'shared', replaces: held.approval_id }));
  await tap(ctx, 'maya', yes.job_id as string);
  await ctx.queue.drain();
  return { held, yes };
}

describe('S6 audit: plain sentences, stored once', () => {
  it('tells the story of a held ride, the cheaper one, and the saving', async () => {
    const ctx = await newHousehold();
    await savedStory(ctx);
    const t = await texts(ctx);
    expect(t).toEqual([
      expect.stringMatching(/^Maya asked for a \$38 ride at \d{1,2}:\d\d [AP]M\. Held: over Maya's \$20 a week\. Rule: Maya's \$20 a week\.$/), // the sentence names the rule that decided
      expect.stringMatching(/^Maya asked for a \$14 ride at \d{1,2}:\d\d [AP]M\. Waiting for Maya's phone\. Rule: within Maya's limit\.$/),
      expect.stringMatching(/^Ride booked for Maya: \$14 at \d{1,2}:\d\d [AP]M\.$/),
      'Maya took a shared ride for $14, not $38. Saved $24.',
    ]);
  });

  it('Mom saying yes is in the log', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya');
    const held = await requestAction(ctx.deps, ctx.hh, ride('airport'));
    const a = (await getApproval(ctx.deps, ctx.hh, held.approval_id as string))!;
    await approveRequest(ctx.deps, ctx.hh, 'mom', a.id, { number: a.number, method: 'phone' });
    await ctx.queue.drain();
    const t = await texts(ctx);
    expect(t.some((x) => /^Mom said yes at \d{1,2}:\d\d [AP]M\.$/.test(x))).toBe(true);
    expect(t.some((x) => /^Ride booked for Maya: \$38/.test(x))).toBe(true);
  });

  it('home actions, sign-ins and lock-outs are logged too', async () => {
    const ctx = await newHousehold();
    const r = await confirmIdentity(ctx.deps, ctx.hh, { name: 'Maya' });
    const c = (await getChallenge(ctx.deps, ctx.hh, r.challenge_id!))!;
    await phoneConfirm(ctx.deps, ctx.hh, 'maya', { challenge_id: c.id, number: c.number });
    await requestAction(ctx.deps, ctx.hh, { service: 'sim-home', action: 'light', item: 'lights', value: 'off' });
    await requestAction(ctx.deps, ctx.hh, { service: 'sim-home', action: 'unlock', item: 'front door' });
    for (let i = 0; i < 3; i++) await confirmIdentity(ctx.deps, ctx.hh, { name: 'Maya' });
    const t = (await texts(ctx)).join('\n');
    expect(t).toMatch(/Maya confirmed on their phone at/);
    expect(t).toMatch(/Maya asked to turn the lights off at .* Done\./);
    expect(t).toMatch(/Maya asked to unlock the front door at .* No\. Only adults can do that\./);
    expect(t).toMatch(/Locked for 10 minutes at/);
    const cats = (await readAudit(ctx.store, ctx.hh)).map((e) => e.category);
    expect(new Set(cats)).toEqual(new Set(['who', 'light', 'lock']));
  });

  it('every sentence is short and has no tech words', async () => {
    const ctx = await newHousehold();
    await savedStory(ctx);
    for (const text of await texts(ctx)) {
      for (const sentence of text.split(/(?<=\.)\s+/)) expect(sentence.split(/\s+/).length, sentence).toBeLessThan(12);
      for (const w of BANNED_WORDS) expect(text.toLowerCase()).not.toMatch(new RegExp(`\\b${w}\\b`));
    }
  });

  it('filters by person and by day', async () => {
    let t = Date.parse('2026-10-14T16:00:00-04:00');
    const ctx = await newHousehold({ now: () => t });
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone', t);
    await requestAction(ctx.deps, ctx.hh, { service: 'sim-home', action: 'light', value: 'on' });
    t += 24 * 3600_000;
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone', t);
    await requestAction(ctx.deps, ctx.hh, { service: 'sim-home', action: 'light', value: 'off' });
    expect(await readAudit(ctx.store, ctx.hh, { person: 'maya' })).toHaveLength(1);
    expect(await readAudit(ctx.store, ctx.hh, { day: '2026-10-15' })).toHaveLength(1);
    expect((await readAudit(ctx.store, ctx.hh, { day: '2026-10-15' }))[0].person).toBe('mom');
    expect(await readAudit(ctx.store, ctx.hh, { person: 'leo' })).toHaveLength(0);
  });

  it('entries expire after 90 days (TTL set), and no audio or secrets are stored', async () => {
    const ctx = await newHousehold();
    await requestAction(ctx.deps, ctx.hh, { service: 'sim-home', action: 'light', value: 'on' });
    const row = (await ctx.store.query(Store.hk(ctx.hh), 'AUDIT#'))[0];
    const days = (row.ttl - Date.now() / 1000) / 86400;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91);
  });
});

describe('S6 hash chain: tampering shows', () => {
  async function chain(n = 5, now?: () => number) {
    const ctx = await newHousehold(now ? { now } : {});
    for (let i = 0; i < n; i++) await appendAudit(ctx.deps, ctx.hh, tz, { kind: 'ask', category: 'home', person: 'mom', personName: 'Mom', text: `Entry ${i + 1}.`, data: { n: i + 1 } });
    return ctx;
  }
  const rowKey = (hh: string, seq: number) => ({ pk: Store.hk(hh), sk: `AUDIT#${String(seq).padStart(10, '0')}` });

  it('a clean log verifies', async () => {
    const ctx = await chain();
    expect(await verifyAudit(ctx.store, ctx.hh)).toMatchObject({ ok: true, checked: 5, anchored: true });
  });
  it('an edited sentence is caught', async () => {
    const ctx = await chain();
    await ctx.store.update({ Key: rowKey(ctx.hh, 3), UpdateExpression: 'SET #t = :t', ExpressionAttributeNames: { '#t': 'text' }, ExpressionAttributeValues: { ':t': 'Nothing happened.' } });
    expect(await verifyAudit(ctx.store, ctx.hh)).toMatchObject({ ok: false, badSeq: 3, reason: 'an entry was edited' });
  });
  it('an edited amount inside the data is caught', async () => {
    const ctx = await chain();
    await ctx.store.update({ Key: rowKey(ctx.hh, 2), UpdateExpression: 'SET #d.n = :v', ExpressionAttributeNames: { '#d': 'data' }, ExpressionAttributeValues: { ':v': 999 } });
    expect(await verifyAudit(ctx.store, ctx.hh)).toMatchObject({ ok: false, badSeq: 2 });
  });
  it('a removed entry in the middle is caught', async () => {
    const ctx = await chain();
    await ctx.store.delete(rowKey(ctx.hh, 3).pk, rowKey(ctx.hh, 3).sk);
    expect(await verifyAudit(ctx.store, ctx.hh)).toMatchObject({ ok: false, reason: 'an entry is missing' });
  });
  it('a cut-off end is caught', async () => {
    const ctx = await chain();
    await ctx.store.delete(rowKey(ctx.hh, 5).pk, rowKey(ctx.hh, 5).sk);
    expect(await verifyAudit(ctx.store, ctx.hh)).toMatchObject({ ok: false, reason: 'the end of the log was cut off' });
  });
  it('a swapped hash is caught', async () => {
    const ctx = await chain();
    await ctx.store.update({ Key: rowKey(ctx.hh, 4), UpdateExpression: 'SET prev = :p', ExpressionAttributeValues: { ':p': 'abc' } });
    expect((await verifyAudit(ctx.store, ctx.hh)).ok).toBe(false);
  });
  it('20 writers at once still make one clean chain', async () => {
    const ctx = await newHousehold();
    await Promise.all(Array.from({ length: 20 }, (_, i) => appendAudit(ctx.deps, ctx.hh, tz, { kind: 'ask', category: 'home', person: 'mom', personName: 'Mom', text: `Parallel ${i}.` })));
    const r = await verifyAudit(ctx.store, ctx.hh);
    expect(r).toMatchObject({ ok: true, checked: 20 });
    expect((await readAudit(ctx.store, ctx.hh, { limit: 100 })).map((e) => e.seq).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
  it('old entries can be deleted after a daily checkpoint without breaking the check', async () => {
    let t = Date.parse('2026-10-10T12:00:00-04:00');
    const ctx = await newHousehold({ now: () => t });
    for (let i = 0; i < 3; i++) await appendAudit(ctx.deps, ctx.hh, tz, { kind: 'ask', category: 'home', person: 'mom', personName: 'Mom', text: `Day one ${i}.` });
    t += 24 * 3600_000;
    for (let i = 0; i < 2; i++) await appendAudit(ctx.deps, ctx.hh, tz, { kind: 'ask', category: 'home', person: 'mom', personName: 'Mom', text: `Day two ${i}.` });
    expect((await ctx.store.query(Store.hk(ctx.hh), 'CHK#')).map((c) => c.seq)).toEqual([3]);
    for (let s = 1; s <= 3; s++) await ctx.store.delete(rowKey(ctx.hh, s).pk, rowKey(ctx.hh, s).sk); // privacy expiry removes day one
    expect(await verifyAudit(ctx.store, ctx.hh)).toMatchObject({ ok: true, checked: 2, anchored: true });
    // and tampering with what remains is still caught
    await ctx.store.update({ Key: rowKey(ctx.hh, 4), UpdateExpression: 'SET #t = :t', ExpressionAttributeNames: { '#t': 'text' }, ExpressionAttributeValues: { ':t': 'x' } });
    expect((await verifyAudit(ctx.store, ctx.hh)).ok).toBe(false);
  });

  it('the verify script catches an edited row (exit code 1) and passes a clean log (exit code 0)', async () => {
    const ctx = await chain(4);
    const run = () => spawnSync('npx', ['tsx', 'scripts/verify-audit.ts', ctx.hh, '--local'], { encoding: 'utf8' });
    const ok = run();
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/audit log OK: 4 entries/);
    await ctx.store.update({ Key: rowKey(ctx.hh, 2), UpdateExpression: 'SET #t = :t', ExpressionAttributeNames: { '#t': 'text' }, ExpressionAttributeValues: { ':t': 'Edited.' } });
    const bad = run();
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/BROKEN at entry 2: an entry was edited/);
  }, 60000);
});

describe('S6 voice answers and status', () => {
  it('"What did the kids buy this week?" → totals first, two or three short sentences', async () => {
    const ctx = await newHousehold();
    await savedStory(ctx);
    const r = await voiceSummary(ctx.deps, ctx.hh, { who: 'kids', when: 'this week' });
    expect(r.say).toBe("The kids spent $14 this week, in 1 buy. The last was Maya's, $14. You saved $24.");
    expect(r).toMatchObject({ spent_cents: 1400, buys: 1, saved_cents: 2400 });
    const sentences = r.say.split(/(?<=\.)\s+/);
    expect(sentences.length).toBeLessThanOrEqual(4);
    for (const s of sentences) expect(s.split(/\s+/).length).toBeLessThan(12);
  });
  it('nothing bought → says so, short', async () => {
    const ctx = await newHousehold();
    expect((await voiceSummary(ctx.deps, ctx.hh, { who: 'kids', when: 'this week' })).say).toBe('The kids bought nothing this week.');
  });
  it('finds last week\'s purchases', async () => {
    let t = Date.parse('2026-10-14T16:00:00-04:00');
    const ctx = await newHousehold({ now: () => t });
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone', t);
    const r = await requestAction(ctx.deps, ctx.hh, ride('mall'));
    await tap(ctx, 'maya', r.job_id as string);
    await ctx.queue.drain();
    t = Date.parse('2026-10-21T12:00:00-04:00');
    expect((await voiceSummary(ctx.deps, ctx.hh, { who: 'kids', when: 'this week' })).say).toBe('The kids bought nothing this week.');
    expect((await voiceSummary(ctx.deps, ctx.hh, { who: 'kids', when: 'last week' })).say).toMatch(/^The kids spent \$15 last week, in 1 buy\./);
    expect((await voiceSummary(ctx.deps, ctx.hh, { who: 'maya', when: 'last week' })).say).toMatch(/^Maya spent \$15 last week, in 1 buy\./);
    expect((await voiceSummary(ctx.deps, ctx.hh, { who: 'mom', when: 'last week' })).say).toBe('Mom bought nothing last week.');
  });
  it('household status is real: who is here, what is waiting, what is left', async () => {
    const ctx = await newHousehold();
    expect((await householdStatus(ctx.deps, ctx.hh)).say).toBe('Your house is quiet. Nothing is waiting. Maya has $20 left this week.');
    await speakAs(ctx.store, ctx.hh, 'maya');
    await requestAction(ctx.deps, ctx.hh, ride('airport'));
    const s = await householdStatus(ctx.deps, ctx.hh);
    expect(s.say).toBe('1 thing is waiting for an adult. Maya has $20 left this week.');
    expect(s.waiting_approvals).toBe(1);
    expect(s.members.map((m) => m.name)).toEqual(['Leo', 'Maya', 'Mom'].sort());
  });
});

describe('S6 screens', () => {
  it('timeline and approval screens show the sentences, one icon per kind, and escape outside text', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya');
    const held = await requestAction(ctx.deps, ctx.hh, { ...ride('airport'), item: 'ride to the airport <img src=x onerror=alert(1)>' });
    const a = (await getApproval(ctx.deps, ctx.hh, held.approval_id as string))!;
    const card = approvalsHtml([a]);
    expect(card).toContain('Maya');
    expect(card).toContain('$38');
    expect(card).not.toContain('<img');
    expect(card).toContain('&lt;img');
    const tl = timelineHtml(await readAudit(ctx.store, ctx.hh));
    expect(tl).toContain('🛒');
    expect(tl).toContain('Held: over Maya&#39;s $20 a week.');
  });
});

describe('S6 review fixes', () => {
  it('who may read the log: guests nothing, kids only their own, adults everything', async () => {
    const { buildMcpServer } = await import('../../src/mcp/server.js');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const ctx = await newHousehold();
    await savedStory(ctx);
    const server = buildMcpServer(ctx.deps, ctx.hh);
    const [x, y] = InMemoryTransport.createLinkedPair();
    await server.connect(x);
    const client = new Client({ name: 't', version: '1' });
    await client.connect(y);
    const call = async (name: string, args: any) => (await client.callTool({ name, arguments: args })) as any;
    const { setSession } = await import('../../src/core/household.js');
    await ctx.store.delete(Store.hk(ctx.hh), 'SESSION#current');
    expect((await call('audit_log', { who: 'kids' })).structuredContent.say).toBe('Tell me who you are first.');
    expect((await call('show_on_screen', { view: 'timeline' })).structuredContent.say).toBe('Tell me who you are first.');
    await setSession(ctx.store, ctx.hh, 'leo', 'pin');
    expect((await call('show_on_screen', { view: 'timeline' })).structuredContent.html).not.toContain('Maya');
    expect((await call('audit_log', { who: 'kids' })).structuredContent.say).toBe('Leo bought nothing this week.');
    await setSession(ctx.store, ctx.hh, 'maya', 'phone');
    expect((await call('show_on_screen', { view: 'timeline', person: 'mom' })).structuredContent.html).toContain('Maya'); // asked for Mom, got her own
    await setSession(ctx.store, ctx.hh, 'mom', 'phone');
    expect((await call('audit_log', { who: 'kids' })).structuredContent.say).toMatch(/^The kids spent \$14/);
  });

  it('a wrong approval attempt by a teen is in the log', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya');
    const held = await requestAction(ctx.deps, ctx.hh, ride('airport'));
    const a = (await getApproval(ctx.deps, ctx.hh, held.approval_id as string))!;
    await approveRequest(ctx.deps, ctx.hh, 'maya', a.id, { number: a.number, method: 'phone' });
    expect((await texts(ctx)).some((x) => /^Maya tried to say yes at .* No\. Only adults can\.$/.test(x))).toBe(true);
  });

  it('words from the caller are not copied into the log as they are', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya');
    await requestAction(ctx.deps, ctx.hh, { service: 'sim-home', action: 'delete everything <script>' + 'x'.repeat(500) });
    await requestAction(ctx.deps, ctx.hh, { service: 'mock-shop', action: 'purchase', item: 'gift card' + 'y'.repeat(400) + '<b>' });
    for (const t of await texts(ctx)) {
      expect(t.length).toBeLessThan(200);
      expect(t).not.toMatch(/[<>]/);
    }
  });

  it('a keyed hash: rebuilding the chain without the key is caught', async () => {
    const ctx = await newHousehold();
    for (let i = 0; i < 3; i++) await appendAudit(ctx.deps, ctx.hh, tz, { kind: 'ask', category: 'home', person: 'mom', personName: 'Mom', text: `E ${i}.` });
    const prevKey = process.env.HG_AUDIT_KEY;
    process.env.HG_AUDIT_KEY = 'someone-elses-key';
    expect((await verifyAudit(ctx.store, ctx.hh)).ok).toBe(false);
    if (prevKey === undefined) delete process.env.HG_AUDIT_KEY;
    else process.env.HG_AUDIT_KEY = prevKey;
    expect((await verifyAudit(ctx.store, ctx.hh)).ok).toBe(true);
  });

  it('a log failure never changes an answer', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya');
    const real = ctx.deps.store.transact.bind(ctx.deps.store);
    ctx.deps.store.transact = async (items: any[], token?: string) => {
      if (items.some((i) => i.Put?.Item?.sk?.startsWith('AUDIT#'))) throw new Error('audit table down');
      return real(items, token);
    };
    const r = await requestAction(ctx.deps, ctx.hh, { service: 'sim-home', action: 'light', item: 'lights', value: 'off' });
    expect(r).toMatchObject({ outcome: 'allowed', done: true });
  });
});

describe('S6 hash ignores key order', () => {
  it('data whose keys are not alphabetical still verifies after a round trip through the table', async () => {
    const ctx = await newHousehold();
    await appendAudit(ctx.deps, ctx.hh, tz, { kind: 'ask', category: 'cart', person: 'maya', personName: 'Maya', text: 'x.', data: { zebra: 1, apple: { z: 2, a: 1 }, mid: [{ y: 1, b: 2 }] } });
    expect((await verifyAudit(ctx.store, ctx.hh)).ok).toBe(true);
  });
});

describe('S6 one icon per kind', () => {
  it('lock, light, cart and rule changes each show their own icon on the timeline', async () => {
    const ctx = await newHousehold();
    const tz = 'America/New_York';
    for (const category of ['lock', 'light', 'cart', 'rule'] as const) {
      await appendAudit(ctx.deps, ctx.hh, tz, { kind: `test_${category}`, category, person: 'mom', personName: 'Mom', text: `A ${category} thing happened.`, data: {} });
    }
    const tl = timelineHtml(await readAudit(ctx.store, ctx.hh));
    for (const [category, icon] of [['lock', '🔒'], ['light', '💡'], ['cart', '🛒'], ['rule', '📝']] as const) {
      expect(tl, category).toMatch(new RegExp(`data-category="${category}"[^>]*><span class="ic"[^>]*>${icon}<`));
    }
  });
});
