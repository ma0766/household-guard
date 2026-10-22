import { describe, expect, it } from 'vitest';
import { newHousehold, speakAs } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';
import { phoneInbox } from '../../src/identity/confirm.js';
import { jobStatus } from '../../src/core/jobs.js';
import { StandInPlanner, type Planner } from '../../src/projects/planner.js';
import { getProject, planPage } from '../../src/projects/projects.js';
import { Store } from '../../src/core/store.js';
import { tap } from '../s20/helpers.js';

const start = (item = 'a website for my bakery') => ({ service: 'projects', action: 'start_project', item });
const publish = (item = 'bakery') => ({ service: 'projects', action: 'publish_project', item });

describe('start a project', () => {
  it('"start a project: a website for my bakery" is a long job: the reply is quick, a model writes a plan, the link goes to the asker\'s phone', async () => {
    const planner = new StandInPlanner();
    const ctx = await newHousehold({ planner });
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    const t0 = Date.now();
    const r = await requestAction(ctx.deps, ctx.hh, start());
    expect(Date.now() - t0).toBeLessThan(500);
    expect(r).toMatchObject({ outcome: 'allowed', done: false, next: 'wait_for_plan' });
    expect(r.job_id).toBeTruthy();
    await ctx.queue.drain();
    expect(planner.calls).toEqual(['a website for my bakery']);
    expect(await jobStatus(ctx.deps, ctx.hh, r.job_id as string)).toMatchObject({ status: 'done', done: true, say: 'Your plan is ready. It is on your phone.' });
    // the link is on Maya's phone, not Mom's, and not in the answer
    const link = (await phoneInbox(ctx.deps, ctx.hh, 'maya')).links[0];
    expect(link.text).toBe('Your plan is ready. Tap to read it.');
    expect((await phoneInbox(ctx.deps, ctx.hh, 'mom')).links).toEqual([]);
    expect(JSON.stringify(r)).not.toContain('/plan/');
    const m = link.url.match(/^\/plan\/([^/]+)\/([^/]+)\/([^/]+)$/)!;
    const page = (await planPage(ctx.deps, m[1], m[2], m[3]))!;
    expect(page).toContain('bakery');
    expect(page).toContain('Not published. An adult must say yes first.');
    expect(await planPage(ctx.deps, m[1], m[2], 'wrong-slug-wrong')).toBeUndefined();
  });
  it('a child may ask for a plan; a guest may not; only the asker and adults can watch the job', async () => {
    const ctx = await newHousehold({ planner: new StandInPlanner() });
    await speakAs(ctx.store, ctx.hh, 'leo', 'pin');
    const r = await requestAction(ctx.deps, ctx.hh, start('a lemonade stand'));
    expect(r.outcome).toBe('allowed');
    await ctx.queue.drain();
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    expect((await jobStatus(ctx.deps, ctx.hh, r.job_id as string)).status).toBe('unknown');
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    expect((await jobStatus(ctx.deps, ctx.hh, r.job_id as string)).status).toBe('done');
    await ctx.store.delete(Store.hk(ctx.hh), 'SESSION#current');
    expect((await requestAction(ctx.deps, ctx.hh, start())).outcome).toBe('denied');
  });
  it('if the writer fails, nothing is published or sent and an adult is told', async () => {
    const broken: Planner = { async plan() { throw new Error('model is down'); } };
    const ctx = await newHousehold({ planner: broken });
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    const r = await requestAction(ctx.deps, ctx.hh, start());
    await ctx.queue.drain();
    expect(await jobStatus(ctx.deps, ctx.hh, r.job_id as string)).toMatchObject({ status: 'failed', done: false });
    expect((await phoneInbox(ctx.deps, ctx.hh, 'mom')).notices.map((n) => n.text).join()).toContain("Maya's project plan could not be written.");
    expect((await phoneInbox(ctx.deps, ctx.hh, 'maya')).links).toEqual([]);
  });
  it('hostile words in the goal or the plan cannot put code on the page, and the same message twice writes one plan', async () => {
    const planner = new StandInPlanner();
    const ctx = await newHousehold({ planner });
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    const r = await requestAction(ctx.deps, ctx.hh, start('<script>alert(1)</script> a bakery site'));
    await ctx.queue.send({ hh: ctx.hh, jobId: r.job_id as string, kind: 'project' }); // delivered twice
    await ctx.queue.drain();
    expect(planner.calls).toHaveLength(1);
    const p = (await getProject(ctx.deps, ctx.hh, r.job_id as string))!;
    p.plan = '<img src=x onerror=alert(1)> plan';
    await ctx.store.put({ pk: Store.hk(ctx.hh), sk: `PROJECT#${p.id}`, ...p });
    const page = (await planPage(ctx.deps, ctx.hh, p.id, p.slug))!;
    expect(page).not.toMatch(/<script|<img/i);
    expect(page).toContain('&lt;img');
  });
});

describe('publishing or sending is acting in your name', () => {
  async function made() {
    const ctx = await newHousehold({ planner: new StandInPlanner() });
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    const r = await requestAction(ctx.deps, ctx.hh, start());
    await ctx.queue.drain();
    return { ctx, id: r.job_id as string };
  }
  it('an adult asks to publish: nothing goes out until her own tap; then it is published once', async () => {
    const { ctx, id } = await made();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const r = await requestAction(ctx.deps, ctx.hh, publish());
    expect(r).toMatchObject({ outcome: 'allowed', done: false, next: 'confirm_on_phone', tier: 'high' });
    expect((await getProject(ctx.deps, ctx.hh, id))!.published).toBeUndefined();
    const out = await tap(ctx, 'mom', r.job_id as string);
    expect(out.say).toBe('Done. It is published.');
    expect((await getProject(ctx.deps, ctx.hh, id))!.published).toBe(true);
    // a second publish finds nothing new to publish
    const again = await requestAction(ctx.deps, ctx.hh, publish());
    expect((await tap(ctx, 'mom', again.job_id as string)).say).toBe("That isn't set up yet.");
  });
  it('a teen is held for an adult, a guest is refused, and an unknown project finds nothing', async () => {
    const { ctx, id } = await made();
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    expect((await requestAction(ctx.deps, ctx.hh, publish())).outcome).toBe('held');
    await ctx.store.delete(Store.hk(ctx.hh), 'SESSION#current');
    expect((await requestAction(ctx.deps, ctx.hh, publish())).outcome).toBe('denied');
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    expect(await requestAction(ctx.deps, ctx.hh, publish('spaceship'))).toMatchObject({ outcome: 'denied', reason: 'I could not find that project.' });
    expect((await getProject(ctx.deps, ctx.hh, id))!.published).toBeUndefined();
  });
  it('an adult who only gave a PIN cannot publish', async () => {
    const { ctx, id } = await made();
    await speakAs(ctx.store, ctx.hh, 'mom', 'pin');
    expect((await requestAction(ctx.deps, ctx.hh, publish())).outcome).not.toBe('allowed');
    expect((await getProject(ctx.deps, ctx.hh, id))!.published).toBeUndefined();
  });
});
