import { randomBytes } from 'node:crypto';
import type { Deps } from '../core/request-action.js';
import { Store } from '../core/store.js';
import { defaultSiteBuilder, siteNameOf, type SiteBuilder } from './builder.js';
import { notifyAdults } from '../identity/guard.js';
import { emit } from '../audit/emit.js';
import { T } from '../text.js';

// A long job (S15): the reply is a job id at once; the building happens in the worker, one step at a time, and the percent is
// written as it goes. The same job message arriving twice builds one site (a conditional claim, as the ride jobs do).
export const siteBuilderOf = (deps: Deps): SiteBuilder => (deps.sites ??= defaultSiteBuilder(deps.store));
const key = (id: string) => `SITEJOB#${id}`;
const LEASE_MS = 90 * 1000; // shorter than the queue's wait before it delivers again, so a crashed run is taken over

export interface SiteJob { id: string; personId: string; name: string; brief: string; status: 'queued' | 'running' | 'done' | 'failed'; progress: number; say?: string; previewUrl?: string; siteId?: string; announced?: boolean; runningAt?: number; runToken?: string }

export async function startSiteJob(deps: Deps, hh: string, jobId: string, personId: string, item: string | undefined): Promise<void> {
  const name = siteNameOf(item);
  await deps.store.put({ pk: Store.hk(hh), sk: key(jobId), id: jobId, personId, name, brief: `A one-page site for ${name}.`, status: 'queued', progress: 0, ttl: Math.floor(Date.now() / 1000) + 30 * 86400 }, { ifNotExists: true });
  await deps.queue!.send({ hh, jobId, kind: 'site' });
}

export async function runSiteJob(deps: Deps, hh: string, jobId: string): Promise<void> {
  const j = (await deps.store.get(Store.hk(hh), key(jobId))) as unknown as SiteJob | undefined;
  if (!j) return;
  const now = (deps.now ?? Date.now)();
  const me = randomBytes(8).toString('hex'); // this run's own token: every later write must still carry it (a stale run cannot overwrite a newer one)
  try {
    await deps.store.update({ Key: { pk: Store.hk(hh), sk: key(jobId) }, UpdateExpression: 'SET #s = :run, runningAt = :now, runToken = :me', ConditionExpression: '#s = :q OR (#s = :run AND runningAt < :stale)', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':run': 'running', ':q': 'queued', ':now': now, ':stale': now - LEASE_MS, ':me': me } });
  } catch (e: any) {
    if (e?.name === 'ConditionalCheckFailedException') {
      const cur = (await deps.store.get(Store.hk(hh), key(jobId))) as unknown as SiteJob | undefined;
      if (cur?.status === 'running') throw new Error('another run has it: try again after its lease', { cause: e }); // the queue delivers it again later, so a crashed run is taken over
      return; // finished
    }
    throw e;
  }
  if (j.status === 'running' && j.siteId) await siteBuilderOf(deps).remove(j.siteId).catch(() => undefined); // a crashed run's half-made draft
  const builder = siteBuilderOf(deps);
  const mine = { ConditionExpression: 'runToken = :me' };
  const write = async (update: string, names: Record<string, string>, values: Record<string, unknown>) => {
    await deps.store.update({ Key: { pk: Store.hk(hh), sk: key(jobId) }, UpdateExpression: update, ...mine, ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}), ExpressionAttributeValues: { ':me': me, ...values } });
  };
  const progress = async (p: number, siteId?: string) => {
    await write('SET progress = :p' + (siteId ? ', siteId = :sid' : ''), {}, { ':p': p, ...(siteId ? { ':sid': siteId } : {}) });
    (builder as { observe?: (n: number) => void }).observe?.(p);
  };
  let siteId: string | undefined;
  let published = false;
  let url: string;
  try {
    siteId = (await builder.create(j.name)).id;
    await progress(20, siteId);
    await builder.write(siteId, j.name, j.brief);
    await progress(55);
    url = (await builder.publish(siteId)).url;
    published = true;
  } catch (e: any) {
    if (e?.name === 'ConditionalCheckFailedException') return; // a newer run owns this job now: leave it alone
    const removed = siteId ? await builder.remove(siteId).then(() => true, () => false) : true; // nothing half-made is left
    const say = published && !removed ? T.siteFailedLeft : T.siteFailed;
    await write('SET #s = :f, say = :say REMOVE previewUrl', { '#s': 'status' }, { ':f': 'failed', ':say': say }).catch(() => undefined);
    if (!removed) await notifyAdults(deps.store, hh, `A site could not be removed. Its number is ${siteId}.`, now, j.personId, 'Someone').catch(() => undefined);
    await emit(deps, hh, { kind: 'site', category: 'home', person: j.personId, personName: 'Someone', text: (t) => `A site could not be finished at ${t}. ${removed ? 'Nothing was published.' : 'An adult was told.'}` }).catch(() => undefined);
    return;
  }
  await progress(85).catch(() => undefined); // best effort: a lost progress note never undoes a published site
  // published: from here on nothing may delete it. A lost note or progress write never undoes a good site.
  try {
    await write('SET #s = :d, progress = :p, say = :say, previewUrl = :u, announced = :f', { '#s': 'status' }, { ':d': 'done', ':p': 100, ':say': T.siteReady(j.name), ':u': url, ':f': false });
    (builder as { observe?: (n: number) => void }).observe?.(100);
  } catch (e) {
    console.error('site: could not record the finished job', e);
    return;
  }
  await notifyAdults(deps.store, hh, T.siteReady(j.name), (deps.now ?? Date.now)(), j.personId, 'Someone').catch((e) => console.error('site: note failed', e));
}

export async function getSiteJob(deps: Deps, hh: string, id: string): Promise<SiteJob | undefined> {
  return (await deps.store.get(Store.hk(hh), key(id))) as unknown as SiteJob | undefined;
}

// "Done" is said once: the next time that person asks how the house is doing.
export async function announceSites(deps: Deps, hh: string, personId: string): Promise<string[]> {
  const out: string[] = [];
  for (const r of await deps.store.query(Store.hk(hh), 'SITEJOB#')) {
    const j = r as unknown as SiteJob;
    if (j.personId !== personId || j.status !== 'done' || j.announced !== false) continue;
    try {
      await deps.store.update({ Key: { pk: Store.hk(hh), sk: key(j.id) }, UpdateExpression: 'SET announced = :t', ConditionExpression: 'announced = :f', ExpressionAttributeValues: { ':t': true, ':f': false } });
      out.push(j.say ?? T.siteReady(j.name));
    } catch {
      /* someone else said it */
    }
  }
  return out;
}
