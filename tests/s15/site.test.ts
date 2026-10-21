import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { newHousehold, speakAs } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';
import { phoneConfirm, phoneInbox } from '../../src/identity/confirm.js';
import { getChallenge } from '../../src/approvals/challenge.js';
import { jobStatus } from '../../src/core/jobs.js';
import { StandInSiteBuilder, defaultSiteBuilder, WixMcpSiteBuilder } from '../../src/sites/builder.js';
import { householdStatus } from '../../src/audit/report.js';
import { createApp } from '../../src/server.js';
import { BANNED_WORDS } from '../../src/text.js';

// S15: a long job. "Build a one-page site for my bakery" answers at once with a job; the work happens in the worker, with
// progress, and ends with a published preview. The site builder is Wix's MCP server in production; with no Wix keys a
// stand-in with the same interface builds a one-page site in our own table (labelled in docs/PROGRESS.md).
type Ctx = Awaited<ReturnType<typeof setup>>;
async function setup() {
  const store = (await newHousehold()).store;
  const builder = new StandInSiteBuilder(store, 'https://house.example');
  const ctx = await newHousehold({ sites: builder });
  return { ...ctx, builder };
}
const ask = (item = 'a one-page site for my bakery, Sunny Bakery') => ({ service: 'wix', action: 'build_site', item });
async function momAsks(ctx: Ctx, args = ask()) {
  await speakAs(ctx.store, ctx.hh, 'mom');
  const t = Date.now();
  const r = await requestAction(ctx.deps, ctx.hh, args);
  return { r, ms: Date.now() - t };
}
async function tap(ctx: Ctx, id: string) {
  const c = (await getChallenge(ctx.deps, ctx.hh, id))!;
  return phoneConfirm(ctx.deps, ctx.hh, 'mom', { challenge_id: c.id, number: c.number });
}

describe('S15 a long job answers at once and finishes in the worker', () => {
  it('Mom asks: an answer with a job id comes back fast; nothing is built until she taps; then it is built and published', async () => {
    const ctx = await setup();
    const { r, ms } = await momAsks(ctx);
    expect(r).toMatchObject({ outcome: 'allowed', done: false, next: 'confirm_on_phone' });
    expect(ms).toBeLessThan(500);
    expect(ctx.builder.sites).toHaveLength(0);
    await tap(ctx, r.job_id as string);
    await ctx.queue.drain();
    const j = await jobStatus(ctx.deps, ctx.hh, r.job_id as string);
    expect(j).toMatchObject({ status: 'done', done: true, progress: 100 });
    expect(j.preview_url).toMatch(/^https:\/\/house\.example\/preview\/[A-Za-z0-9_-]{16,}$/);
    expect(j.say).toBe('Your site is ready. Sunny Bakery.');
    expect(ctx.builder.sites).toHaveLength(1);
    expect(ctx.builder.sites[0]).toMatchObject({ name: 'Sunny Bakery', published: true });
  });
  it('the work goes in steps with a growing percent: create, write, publish, done', async () => {
    const ctx = await setup();
    const { r } = await momAsks(ctx);
    await tap(ctx, r.job_id as string);
    await ctx.queue.drain();
    expect(ctx.builder.steps.map((s) => s.name)).toEqual(['create', 'write', 'publish']);
    const seen = (ctx.builder as any).progressSeen as number[];
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen).toEqual(expect.arrayContaining([20, 55, 85, 100]));
  });
  it('while it runs, job_status says how far along it is', async () => {
    const ctx = await setup();
    let release!: () => void;
    ctx.builder.pauseAt = { step: 'write', wait: new Promise<void>((r) => (release = r)) };
    const { r } = await momAsks(ctx);
    await tap(ctx, r.job_id as string);
    await new Promise((r2) => setTimeout(r2, 150));
    const mid = await jobStatus(ctx.deps, ctx.hh, r.job_id as string);
    expect(mid).toMatchObject({ status: 'running', done: false });
    expect(mid.progress).toBe(20);
    expect(mid.say).toBe('Working on it. 20 percent.');
    release();
    await ctx.queue.drain();
    expect((await jobStatus(ctx.deps, ctx.hh, r.job_id as string)).progress).toBe(100);
  });
  it('a teen (or a child) asking is held, and nothing is built', async () => {
    const ctx = await setup();
    await speakAs(ctx.store, ctx.hh, 'maya');
    const r = await requestAction(ctx.deps, ctx.hh, ask());
    expect(r).toMatchObject({ outcome: 'held', done: false });
    expect(ctx.builder.sites).toHaveLength(0);
  });
  it('a guest is denied', async () => {
    const ctx = await setup();
    await ctx.store.delete((await import('../../src/core/store.js')).Store.hk(ctx.hh), 'SESSION#current');
    expect((await requestAction(ctx.deps, ctx.hh, ask())).outcome).toBe('denied');
  });
});

describe('S15 what can go wrong goes wrong safely', () => {
  it('words in the ask cannot put code on the site: the name is cut down and the page is escaped', async () => {
    const ctx = await setup();
    const { r } = await momAsks(ctx, ask('<script>alert(1)</script> site for <b>Evil</b> Bakery & Co'));
    await tap(ctx, r.job_id as string);
    await ctx.queue.drain();
    const html = await ctx.builder.html(ctx.builder.sites[0].id);
    expect(html).not.toMatch(/<script|<b>|alert\(/i);
    expect(ctx.builder.sites[0].name).toMatch(/^[A-Za-z0-9 ,.'&-]{1,40}$/);
  });
  it('if the builder fails part-way: the job fails, nothing is published, the half-made draft is removed, the answer is plain', async () => {
    const ctx = await setup();
    ctx.builder.failAt = 'publish';
    const { r } = await momAsks(ctx);
    await tap(ctx, r.job_id as string);
    await ctx.queue.drain();
    const j = await jobStatus(ctx.deps, ctx.hh, r.job_id as string);
    expect(j).toMatchObject({ status: 'failed', done: false });
    expect(j.say).toBe('I could not finish the site. Nothing was published.');
    expect(ctx.builder.sites.filter((s) => s.published)).toHaveLength(0);
    expect(ctx.builder.sites).toHaveLength(0);
    expect(j.preview_url).toBeUndefined();
  });
  it('the same message delivered again builds ONE site', async () => {
    const ctx = await setup();
    const { r } = await momAsks(ctx);
    await tap(ctx, r.job_id as string);
    await ctx.queue.send({ hh: ctx.hh, jobId: r.job_id as string, kind: 'site' });
    await ctx.queue.send({ hh: ctx.hh, jobId: r.job_id as string, kind: 'site' });
    await ctx.queue.drain();
    expect(ctx.builder.sites).toHaveLength(1);
  });
  it('the same ask sent twice (a retry) is one job', async () => {
    const ctx = await setup();
    await speakAs(ctx.store, ctx.hh, 'mom');
    const { requestActionOnce } = await import('../../src/core/idempotent.js'); // the front door every tool call goes through
    const id = `same${Math.random().toString(36).slice(2)}`;
    const a = await requestActionOnce(ctx.deps, ctx.hh, { ...ask(), request_id: id });
    const b = await requestActionOnce(ctx.deps, ctx.hh, { ...ask(), request_id: id });
    expect(b.job_id).toBe(a.job_id);
  });
  it('who may see a job: the person who asked, and adults; not another kid', async () => {
    const ctx = await setup();
    const { r } = await momAsks(ctx);
    await tap(ctx, r.job_id as string);
    await ctx.queue.drain();
    expect((await jobStatus(ctx.deps, ctx.hh, r.job_id as string)).status).toBe('done');
    await speakAs(ctx.store, ctx.hh, 'maya');
    const seen = await jobStatus(ctx.deps, ctx.hh, r.job_id as string);
    expect(seen.preview_url).toBeUndefined();
    expect(seen.status).not.toBe('done');
  });
});

describe('S15 telling the person, and showing it', () => {
  it('when it is done, the next status question says so, once', async () => {
    const ctx = await setup();
    const { r } = await momAsks(ctx);
    await tap(ctx, r.job_id as string);
    await ctx.queue.drain();
    await speakAs(ctx.store, ctx.hh, 'mom');
    const first = await householdStatus(ctx.deps, ctx.hh, 'mom');
    expect(first.say).toContain('Your site is ready. Sunny Bakery.');
    expect((await householdStatus(ctx.deps, ctx.hh, 'mom')).say).not.toContain('Your site is ready');
    expect((await phoneInbox(ctx.deps, ctx.hh, 'mom')).notices.map((n) => n.text).join(' ')).toMatch(/Your site is ready/);
  });
  it('plain words only', () => {
    for (const line of ['Your site is ready. Sunny Bakery.', 'Working on it. 20 percent.', 'I could not finish the site. Nothing was published.']) for (const w of BANNED_WORDS) expect(line.toLowerCase()).not.toMatch(new RegExp(`\\b${w}\\b`));
  });
});

describe('S15 the preview page', () => {
  let server: Server;
  let base: string;
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup();
    server = createApp(ctx.deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise((r) => server.close(r)));
  it('serves the published page with a locked-down content rule; unknown or odd ids are 404', async () => {
    const { r } = await momAsks(ctx);
    await tap(ctx, r.job_id as string);
    await ctx.queue.drain();
    const id = ctx.builder.sites[0].id;
    const page = await fetch(`${base}/preview/${id}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toMatch(/default-src 'none'/);
    expect(await page.text()).toContain('Sunny Bakery');
    expect((await fetch(`${base}/preview/nope`)).status).toBe(404);
    expect((await fetch(`${base}/preview/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
  });
});

describe('S15 which builder', () => {
  it('no Wix keys: the stand-in; with keys: the Wix MCP builder (never both)', () => {
    delete process.env.WIX_API_KEY;
    delete process.env.WIX_ACCOUNT_ID;
    expect(defaultSiteBuilder(undefined as any).kind).toBe('stand-in');
    process.env.WIX_API_KEY = 'k';
    expect(defaultSiteBuilder(undefined as any).kind).toBe('stand-in'); // a key without an account is not enough
    process.env.WIX_ACCOUNT_ID = 'a';
    expect(defaultSiteBuilder(undefined as any).kind).toBe('wix');
    delete process.env.WIX_API_KEY;
    delete process.env.WIX_ACCOUNT_ID;
  });
  it('the Wix builder asks Wix over MCP with the key and account, and any failure is a failure', async () => {
    const calls: any[] = [];
    const fake = { callTool: async (c: any) => { calls.push(c); return { isError: false, content: [{ type: 'text', text: JSON.stringify({ siteId: 's1', url: 'https://wix.example/p' }) }] }; }, close: async () => undefined };
    const w = new WixMcpSiteBuilder(async () => fake as any);
    const s = await w.create('Sunny Bakery');
    expect(s.id).toBe('s1');
    const bad = new WixMcpSiteBuilder(async () => ({ callTool: async () => { throw new Error('down'); }, close: async () => undefined }) as any);
    await expect(bad.create('x')).rejects.toThrow();
    expect(calls[0].name).toBeTruthy();
  });
});
