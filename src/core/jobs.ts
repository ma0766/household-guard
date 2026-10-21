import type { Deps } from './request-action.js';
import { Store } from './store.js';
import { getChallenge } from '../approvals/challenge.js';
import { getSession, loadHousehold } from './household.js';
import { getSiteJob } from '../sites/job.js';
import { T } from '../text.js';
import { getApproval } from '../approvals/approvals.js';

export interface JobView {
  job_id: string;
  status: 'waiting' | 'running' | 'done' | 'failed' | 'held' | 'unknown';
  say: string;
  done: boolean;
  progress?: number; // long jobs (a site): how far along, 0 to 100
  preview_url?: string;
  name?: string;
}

// Anything slow or waiting on a person has a job id. Alexa asks again later instead of holding the line open (500 ms rule).
export async function jobStatus(deps: Deps, hh: string, id: string): Promise<JobView> {
  try {
    const c = await getChallenge(deps, hh, id);
    if (c) {
      if (c.status === 'open') return { job_id: id, status: (c.expiresAt <= (deps.now ?? Date.now)() ? 'failed' : 'waiting'), say: c.expiresAt <= (deps.now ?? Date.now)() ? 'That ran out of time.' : 'Waiting for your phone.', done: false };
      const r = c.result;
      if (!r) return { job_id: id, status: 'waiting', say: 'Working on it.', done: false }; // the tap closed it a moment ago and its answer is still being written: not a failure, and never a bare "Done."
      if (r.jobId) return jobStatus(deps, hh, r.jobId); // the tap started a job: report on the job
      return { job_id: id, status: r?.done ? 'done' : 'failed', say: r?.reason ?? 'Done.', done: !!r?.done };
    }
    const ap = await getApproval(deps, hh, id);
    if (ap) {
      const now = (deps.now ?? Date.now)();
      if (ap.status === 'open') return ap.expiresAt <= now ? { job_id: id, status: 'failed', say: 'That ran out of time.', done: false } : { job_id: id, status: 'waiting', say: 'Waiting for an adult.', done: false };
      if (ap.status === 'approved' && ap.jobId) return jobStatus(deps, hh, ap.jobId);
      if (ap.status === 'rejected') return { job_id: id, status: 'failed', say: 'An adult said no.', done: false };
      return { job_id: id, status: 'failed', say: 'Okay. That one is closed.', done: false };
    }
    const site = await getSiteJob(deps, hh, id);
    if (site) {
      // only the person who asked, and adults, may see it
      const sess = await getSession(deps.store, hh, (deps.now ?? Date.now)());
      const me = sess && (await loadHousehold(deps.store, hh)).people.find((p) => p.id === sess.personId);
      if (!me || (me.role !== 'adult' && me.id !== site.personId)) return { job_id: id, status: 'unknown', say: "I can't find that.", done: false };
      if (site.status === 'queued' || site.status === 'running') return { job_id: id, status: site.status === 'running' ? 'running' : 'waiting', say: T.siteWorking(site.progress), done: false, progress: site.progress };
      return { job_id: id, status: site.status, say: site.say ?? '', done: site.status === 'done', progress: site.progress, ...(site.status === 'done' && site.previewUrl ? { preview_url: site.previewUrl, name: site.name } : {}) };
    }
    const j = await deps.store.get(Store.hk(hh), `JOB#${id}`);
    if (j) {
      const status = j.status === 'queued' || j.status === 'running' ? 'waiting' : (j.status as JobView['status']);
      return { job_id: id, status, say: status === 'waiting' ? 'Working on it.' : (j.say as string), done: status === 'done', ...(j.newApprovalId ? { approval_id: j.newApprovalId } : {}) } as JobView;
    }
    return { job_id: id, status: 'unknown', say: "I can't find that.", done: false };
  } catch {
    return { job_id: id, status: 'failed', say: 'Something went wrong. Ask an adult.', done: false };
  }
}
