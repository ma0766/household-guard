import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { newHousehold, speakAs } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';
import { createApp } from '../../src/server.js';
import { MemoryNotifier, SesNotifier } from '../../src/notify/notify.js';
import { readToken } from '../../src/auth.js';
import { BANNED_WORDS } from '../../src/text.js';
import { getApproval } from '../../src/approvals/approvals.js';
import { jobStatus } from '../../src/core/jobs.js';
import { countBookings } from '../../src/connectors/mock-ride.js';

// S12: an adult hears about a held request by email, with a link that opens a page to say yes or no — no SMS number needed.
const saved = { ...process.env };
beforeAll(() => { Object.assign(process.env, { HG_PUBLIC_URL: 'https://house.example', HG_APPROVER_EMAILS: JSON.stringify({ mom: 'mom@example.test' }) }); });
afterAll(() => { process.env = saved; });

const airport = { service: 'mock-ride', action: 'purchase', item: 'ride to the airport' };
async function held(notifier = new MemoryNotifier()) {
  const ctx = await newHousehold({ notifier });
  await speakAs(ctx.store, ctx.hh, 'maya');
  const r = await requestAction(ctx.deps, ctx.hh, airport);
  return { ctx, r, notifier };
}
const linkOf = (text: string) => text.match(/https:\/\/house\.example\/approve\?t=[A-Za-z0-9_.-]+/)![0];

describe('S12 the email', () => {
  it('a held ride sends ONE email, to Mom only, with who, what, price, why and a link', async () => {
    const { r, notifier } = await held();
    expect(r.outcome).toBe('held');
    expect(notifier.sent).toHaveLength(1);
    const m = notifier.sent[0];
    expect(m.to).toBe('mom@example.test');
    expect(m.subject).toBe('Maya wants a ride to the airport: $38');
    expect(m.text).toContain('Maya wants: ride to the airport.');
    expect(m.text).toContain('Price: $38.');
    expect(m.text).toContain("Held: over Maya's $20 a week.");
    expect(linkOf(m.text)).toBeTruthy();
    for (const w of BANNED_WORDS) expect(m.text.toLowerCase()).not.toMatch(new RegExp(`\\b${w}\\b`));
    for (const sentence of m.text.replace(/https?:\/\/\S+/g, '').split(/(?<=[.!?:])\s+/)) expect(sentence.split(/\s+/).length, sentence).toBeLessThan(14);
  });
  it('nothing is sent for a request that is not held, or for one that is denied', async () => {
    const notifier = new MemoryNotifier();
    const ctx = await newHousehold({ notifier });
    await speakAs(ctx.store, ctx.hh, 'maya');
    await requestAction(ctx.deps, ctx.hh, { service: 'sim-home', action: 'light', item: 'lights', value: 'off' });
    await requestAction(ctx.deps, ctx.hh, { service: 'sim-home', action: 'unlock', item: 'front door' });
    expect(notifier.sent).toHaveLength(0);
  });
  it('words typed by the caller cannot add lines or fake a header to the email', async () => {
    const notifier = new MemoryNotifier();
    const ctx = await newHousehold({ notifier });
    await speakAs(ctx.store, ctx.hh, 'maya');
    await requestAction(ctx.deps, ctx.hh, { ...airport, item: 'ride to the airport\r\nBcc: attacker@evil.example\r\n\r\nClick https://evil.example' });
    const m = notifier.sent[0];
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.text).not.toContain('evil.example');
    expect(m.text).not.toMatch(/Bcc:/i);
  });
  it('a failing mail service never changes the answer: still held, the approval is still there', async () => {
    const broken = { sent: [], send: async () => { throw new Error('mail is down'); } };
    const { ctx, r } = await held(broken as any);
    expect(r.outcome).toBe('held');
    expect(await getApproval(ctx.deps, ctx.hh, r.approval_id as string)).toMatchObject({ status: 'open' });
  });
  it('a slow mail service does not slow the reply by more than a second', async () => {
    const slow = { sent: [], send: () => new Promise<void>(() => undefined) };
    const t = Date.now();
    const { r } = await held(slow as any);
    expect(r.outcome).toBe('held');
    expect(Date.now() - t).toBeLessThan(2500);
  });
  it('no public address, no email (a link that goes nowhere is worse than none)', async () => {
    const was = process.env.HG_PUBLIC_URL;
    delete process.env.HG_PUBLIC_URL;
    const { notifier } = await held();
    process.env.HG_PUBLIC_URL = was;
    expect(notifier.sent).toHaveLength(0);
  });
  it('the real sender builds a plain-text message from the verified address', async () => {
    const calls: any[] = [];
    const ses = new SesNotifier({ send: async (c: any) => { calls.push(c.input); } } as any, 'house@example.test');
    await ses.send({ to: 'mom@example.test', subject: 'Hello', text: 'Body' });
    expect(calls[0]).toMatchObject({ FromEmailAddress: 'house@example.test', Destination: { ToAddresses: ['mom@example.test'] }, Content: { Simple: { Subject: { Data: 'Hello' }, Body: { Text: { Data: 'Body' } } } } });
  });
});

describe('S12 email review fixes', () => {
  it('two adults are emailed at the same time, with one shared wait (not one after another)', async () => {
    const slow = { sent: [] as any[], send: async (m: any) => { await new Promise((r) => setTimeout(r, 400)); slow.sent.push(m); } };
    process.env.HG_APPROVER_EMAILS = JSON.stringify({ mom: 'mom@example.test', dad: 'dad@example.test' });
    const ctx = await newHousehold({ notifier: slow as any });
    const { Store } = await import('../../src/core/store.js');
    await ctx.store.put({ pk: Store.hk(ctx.hh), sk: 'PERSON#dad', id: 'dad', name: 'Dad', role: 'adult', hasPhone: true });
    await speakAs(ctx.store, ctx.hh, 'maya');
    const t = Date.now();
    await requestAction(ctx.deps, ctx.hh, airport);
    expect(Date.now() - t).toBeLessThan(900); // 2 x 400 ms in a row would be 800+ plus the rest
    expect(slow.sent.map((m) => m.to).sort()).toEqual(['dad@example.test', 'mom@example.test']);
    process.env.HG_APPROVER_EMAILS = JSON.stringify({ mom: 'mom@example.test' });
  });
  it('no more than 3 emails per adult in 10 minutes, however often a teen asks again', async () => {
    const notifier = new MemoryNotifier();
    const ctx = await newHousehold({ notifier });
    await speakAs(ctx.store, ctx.hh, 'maya');
    for (let i = 0; i < 6; i++) await requestAction(ctx.deps, ctx.hh, { ...airport, option_id: i % 2 ? 'economy' : 'standard' });
    expect(notifier.sent.length).toBe(3);
  });
  it('a web address written into the item name does not reach the email', async () => {
    const notifier = new MemoryNotifier();
    const ctx = await newHousehold({ notifier });
    await speakAs(ctx.store, ctx.hh, 'maya');
    await requestAction(ctx.deps, ctx.hh, { ...airport, item: 'ride to the airport visit evil.com now' });
    expect(notifier.sent[0].text).not.toMatch(/evil\.com/);
    expect(notifier.sent[0].subject).not.toMatch(/evil\.com/);
  });
  it('an adult with an email but no phone still sees the card on the page', async () => {
    const notifier = new MemoryNotifier();
    const ctx = await newHousehold({ notifier });
    const { Store } = await import('../../src/core/store.js');
    await ctx.store.put({ pk: Store.hk(ctx.hh), sk: 'PERSON#mom', id: 'mom', name: 'Mom', role: 'adult', hasPhone: false });
    await speakAs(ctx.store, ctx.hh, 'maya');
    const r = await requestAction(ctx.deps, ctx.hh, airport);
    const { phoneInbox } = await import('../../src/identity/confirm.js');
    expect((await phoneInbox(ctx.deps, ctx.hh, 'mom', { link: true })).approvals.map((a) => a.id)).toEqual([r.approval_id]);
    expect((await phoneInbox(ctx.deps, ctx.hh, 'mom')).approvals).toEqual([]); // the plain phone route still needs a phone
  });
});

describe('S12 the link', () => {
  let server: Server;
  let base: string;
  async function start(ctx: Awaited<ReturnType<typeof newHousehold>>) {
    server = createApp(ctx.deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  const withToken = (t: string, path: string, body?: unknown) => fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

  it('the token in the link is for Mom\'s phone, for THIS approval only, and ends with it', async () => {
    const { ctx, r, notifier } = await held();
    const t = linkOf(notifier.sent[0].text).split('t=')[1];
    const c = readToken(t)!;
    expect(c).toMatchObject({ sub: 'mom', aud: 'phone', ap: r.approval_id });
    const a = (await getApproval(ctx.deps, ctx.hh, r.approval_id as string))!;
    expect(c.exp * 1000).toBeLessThanOrEqual(a.expiresAt + 1000); // not longer than the ten minutes
  });

  it('the page opens without any other sign-in, and shows nothing but the card', async () => {
    const { ctx, notifier } = await held();
    await start(ctx);
    try {
      const url = linkOf(notifier.sent[0].text).replace('https://house.example', base);
      const page = await fetch(url);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toMatch(/text\/html/);
      expect(page.headers.get('content-security-policy')).toMatch(/default-src 'none'/);
      const html = await page.text();
      expect(html).not.toMatch(/innerHTML|eval\(/);
      expect(html).toContain('Say yes or no');
    } finally { server.close(); }
  });

  it('the link shows only its own card, and saying yes with the right number books the ride', async () => {
    const { ctx, r, notifier } = await held();
    await start(ctx);
    try {
      const t = linkOf(notifier.sent[0].text).split('t=')[1];
      const inbox = (await (await withToken(t, '/phone/mom/inbox')).json()) as any;
      expect(inbox.approvals.map((a: any) => a.id)).toEqual([r.approval_id]);
      expect(inbox.challenges).toEqual([]);
      const a = (await getApproval(ctx.deps, ctx.hh, r.approval_id as string))!;
      const ok = (await (await withToken(t, '/phone/mom/approve', { approval_id: a.id, number: a.number })).json()) as any;
      expect(ok.status).toBe('approved');
      await ctx.queue.drain();
      expect(await jobStatus(ctx.deps, ctx.hh, ok.job_id)).toMatchObject({ status: 'done' });
      expect(await countBookings(ctx.store, ctx.hh)).toBe(1);
    } finally { server.close(); }
  });

  it('the link cannot approve another request, cannot be used for another person, and cannot confirm a login', async () => {
    const { ctx, notifier } = await held();
    await speakAs(ctx.store, ctx.hh, 'maya');
    const other = await requestAction(ctx.deps, ctx.hh, { ...airport, option_id: 'economy' }); // $24: also over her $20, so a second held request
    await start(ctx);
    try {
      const t = linkOf(notifier.sent[0].text).split('t=')[1];
      const o = (await getApproval(ctx.deps, ctx.hh, other.approval_id as string))!;
      expect((await withToken(t, '/phone/mom/approve', { approval_id: o.id, number: o.number })).status).toBe(403);
      expect((await withToken(t, '/phone/maya/inbox')).status).toBe(403);
      expect((await withToken(t, '/phone/mom/confirm', { challenge_id: 'x', number: 1 })).status).toBe(403);
      expect(await countBookings(ctx.store, ctx.hh)).toBe(0);
    } finally { server.close(); }
  });

  it('a wrong number from the link counts toward the lock like a tap on the phone', async () => {
    const { ctx, r, notifier } = await held();
    await start(ctx);
    try {
      const t = linkOf(notifier.sent[0].text).split('t=')[1];
      const a = (await getApproval(ctx.deps, ctx.hh, r.approval_id as string))!;
      const wrong = a.options.find((n) => n !== a.number)!;
      const out: string[] = [];
      for (let i = 0; i < 4; i++) out.push(((await (await withToken(t, '/phone/mom/approve', { approval_id: a.id, number: wrong })).json()) as any).status);
      expect(out).toContain('locked');
      expect(await countBookings(ctx.store, ctx.hh)).toBe(0);
    } finally { server.close(); }
  });

  it('an old link stops working', async () => {
    const { ctx, notifier } = await held();
    await start(ctx);
    try {
      const t = linkOf(notifier.sent[0].text).split('t=')[1];
      const real = Date.now;
      Date.now = () => real() + 11 * 60 * 1000;
      try { expect((await withToken(t, '/phone/mom/inbox')).status).toBe(401); } finally { Date.now = real; }
    } finally { server.close(); }
  });
});
