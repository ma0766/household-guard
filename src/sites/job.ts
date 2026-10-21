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
const LEASE_MS = 5 * 60 * 1000;

export interface SiteJob { id: string; personId: string; name: string; brief: string; status: 'queued' | 'running' | 'done' | 'failed'; progress: number; say?: string; previewUrl?: string; siteId?: string; announced?: boolean; runningAt?: number }

export async function startSiteJob(deps: Deps, hh: string, jobId: string, personId: string, item: string | undefined): Promise<void> {
  const name = siteNameOf(item);
  await deps.store.put({ pk: Store.hk(hh), sk: key(jobId), id: jobId, personId, name, brief: `A one-page site for ${name}.`, status: 'queued', progress: 0, ttl: Math.floor(Date.now() / 1000) + 30 * 86400 }, { ifNotExists: true });
  await deps.queue!.send({ hh, jobId, kind: 'site' });
}

async function setProgress(deps: Deps, hh: string, id: string, progress: number, extra: Record<string, unknown> = {}) {
  const keys = Object.keys(extra);
  await deps.store.update({ Key: { pk: Store.hk(hh), sk: key(id) }, UpdateExpression: 'SET progress = :p' + keys.map((k) => `, #${k} = :x_${k}`).join(''), ExpressionAttributeNames: Object.fromEntries(keys.map((k) => [`#${k}`, k])), ...(keys.length ? {} : { ExpressionAttributeNames: undefined }), ExpressionAttributeValues: { ':p': progress, ...Object.fromEntries(keys.map((k) => [`:x_${k}`, extra[k]])) } });
  (siteBuilderOf(deps) as any).observe?.(progress);
}

export async function runSiteJob(deps: Deps, hh: string, jobId: string): Promise<void> {
  const j = (await deps.store.get(Store.hk(hh), key(jobId))) as unknown as SiteJob | undefined;
  if (!j) return;
  const now = (deps.now ?? Date.now)();
  try {
    await deps.store.update({ Key: { pk: Store.hk(hh), sk: key(jobId) }, UpdateExpression: 'SET #s = :run, runningAt = :now', ConditionExpression: '#s = :q OR (#s = :run AND runningAt < :stale)', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':run': 'running', ':q': 'queued', ':now': now, ':stale': now - LEASE_MS } });
  } catch (e: any) {
    if (e?.name === 'ConditionalCheckFailedException') return; // someone has it, or it is finished
    throw e;
  }
  const builder = siteBuilderOf(deps);
  let siteId: string | undefined;
  try {
    siteId = (await builder.create(j.name)).id;
    await setProgress(deps, hh, jobId, 20, { siteId });
    await builder.write(siteId, j.name, j.brief);
    await setProgress(deps, hh, jobId, 55);
    const { url } = await builder.publish(siteId);
    await setProgress(deps, hh, jobId, 85);
    await deps.store.update({ Key: { pk: Store.hk(hh), sk: key(jobId) }, UpdateExpression: 'SET #s = :d, progress = :p, say = :say, previewUrl = :u, announced = :f', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':d': 'done', ':p': 100, ':say': T.siteReady(j.name), ':u': url, ':f': false } });
    (builder as any).observe?.(100);
    await notifyAdults(deps.store, hh, T.siteReady(j.name), (deps.now ?? Date.now)(), j.personId, 'Someone');
  } catch {
    if (siteId) await builder.remove(siteId).catch(() => undefined); // nothing half-made is left
    await deps.store.update({ Key: { pk: Store.hk(hh), sk: key(jobId) }, UpdateExpression: 'SET #s = :f, say = :say REMOVE previewUrl', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':f': 'failed', ':say': T.siteFailed } }).catch(() => undefined);
    await emit(deps, hh, { kind: 'site', category: 'home', person: j.personId, personName: 'Someone', text: (t) => `A site could not be finished at ${t}. Nothing was published.` });
  }
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
