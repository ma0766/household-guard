import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Deps } from '../core/request-action.js';
import { Store } from '../core/store.js';
import { defaultPlanner } from './planner.js';
import { notifyAdults } from '../identity/guard.js';
import { emit } from '../audit/emit.js';

// A project is a long job: the reply is a job id at once; the plan is written in the worker; the link goes to the asker's phone.
// Publishing or sending anything is a different action (publish_project): an adult, with a tap.
export interface Project { id: string; personId: string; personName: string; goal: string; status: 'queued' | 'running' | 'ready' | 'failed'; plan?: string; slug: string; published?: boolean; at: number }
const key = (id: string) => `PROJECT#${id}`;
const goalOf = (item: unknown) => String(item ?? '').replace(/[\r\n]+/g, ' ').replace(/[<>]/g, '').trim().slice(0, 120);

export async function startProject(deps: Deps, hh: string, person: { id: string; name: string }, item: unknown): Promise<{ ok: boolean; id?: string; say: string }> {
  const goal = goalOf(item);
  if (goal.length < 3) return { ok: false, say: 'What is the project?' };
  const now = (deps.now ?? Date.now)();
  const id = randomUUID().slice(0, 12);
  const slug = randomBytes(12).toString('base64url'); // the plan page's address: nobody can guess it
  await deps.store.put({ pk: Store.hk(hh), sk: key(id), id, personId: person.id, personName: person.name, goal, status: 'queued', slug, at: now, ttl: Math.floor(now / 1000) + 30 * 86400 }, { ifNotExists: true });
  await deps.queue!.send({ hh, jobId: id, kind: 'project' });
  return { ok: true, id, say: 'Okay. I am writing the plan. It will be on your phone.' };
}

export async function runProject(deps: Deps, hh: string, jobId: string): Promise<void> {
  const j = (await deps.store.get(Store.hk(hh), key(jobId))) as unknown as Project | undefined;
  if (!j) return;
  try {
    await deps.store.update({ Key: { pk: Store.hk(hh), sk: key(jobId) }, UpdateExpression: 'SET #s = :run', ConditionExpression: '#s = :q', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':run': 'running', ':q': 'queued' } });
  } catch {
    return; // another delivery has it, or it is finished
  }
  const finish = (status: string, plan?: string) => deps.store.update({ Key: { pk: Store.hk(hh), sk: key(jobId) }, UpdateExpression: 'SET #s = :s, #p = :p', ExpressionAttributeNames: { '#s': 'status', '#p': 'plan' }, ExpressionAttributeValues: { ':s': status, ':p': plan ?? null } });
  try {
    const plan = await (deps.planner ??= defaultPlanner()).plan(j.goal);
    await finish('ready', plan);
    // the link goes to the asker's own phone (not read aloud, not in the log)
    const now = (deps.now ?? Date.now)();
    await deps.store.put({ pk: Store.hk(hh), sk: `PHONELINK#${j.personId}#${String(now).padStart(15, '0')}`, text: 'Your plan is ready. Tap to read it.', url: `/plan/${hh}/${j.id}/${j.slug}`, at: now, ttl: Math.floor(now / 1000) + 86400 });
    await emit(deps, hh, { kind: 'project', category: 'home', person: j.personId, personName: j.personName, text: (t) => `${j.personName}'s project plan was ready at ${t}.`, data: { project: j.id } });
  } catch {
    await finish('failed').catch(() => undefined); // nothing was written, nothing was sent
    await notifyAdults(deps.store, hh, `${j.personName}'s project plan could not be written.`, (deps.now ?? Date.now)(), j.personId, j.personName).catch(() => undefined);
  }
}

export async function getProject(deps: Deps, hh: string, id: string): Promise<Project | undefined> {
  return (await deps.store.get(Store.hk(hh), key(id))) as unknown as Project | undefined;
}

// the newest ready project (an adult says "publish the bakery site": the words pick a project; only the house's own records are matched)
export async function findProject(deps: Deps, hh: string, words: unknown): Promise<Project | undefined> {
  const w = String(words ?? '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((x) => x.length >= 4 && !['project', 'publish', 'send', 'website', 'plan'].includes(x));
  const all = ((await deps.store.query(Store.hk(hh), 'PROJECT#')) as unknown as Project[]).filter((p) => p.status === 'ready').sort((a, b) => b.at - a.at);
  return all.find((p) => w.length && w.some((x) => p.goal.toLowerCase().includes(x))) ?? (w.length ? undefined : all[0]);
}

export async function publishProject(deps: Deps, hh: string, id: string): Promise<boolean> {
  try {
    await deps.store.update({ Key: { pk: Store.hk(hh), sk: key(id) }, UpdateExpression: 'SET published = :t', ConditionExpression: '#s = :ready AND attribute_not_exists(published)', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':t': true, ':ready': 'ready' } });
    return true;
  } catch {
    return false;
  }
}

// the page an unguessable address shows: the plan, as text. Nothing on it can act.
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export async function planPage(deps: Deps, hh: string, id: string, slug: string): Promise<string | undefined> {
  const p = await getProject(deps, hh, id);
  if (!p || p.status !== 'ready' || !p.plan || !timingSafe(p.slug, slug)) return undefined;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Project plan</title><style>body{font:18px/1.5 system-ui,sans-serif;max-width:640px;margin:16px auto;padding:0 16px;color:#1d2433}pre{white-space:pre-wrap;font:inherit}</style></head><body><h1>${esc(p.goal)}</h1><pre data-testid="plan-text">${esc(p.plan)}</pre><p data-testid="plan-state">${p.published ? 'Published.' : 'Not published. An adult must say yes first.'}</p></body></html>`;
}
function timingSafe(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
