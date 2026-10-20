import type { Deps } from './request-action.js';
import { Store } from './store.js';
import { getChallenge } from '../approvals/challenge.js';

export interface JobView {
  job_id: string;
  status: 'waiting' | 'done' | 'failed' | 'unknown';
  say: string;
  done: boolean;
}

// Anything slow or waiting on a person has a job id. Alexa asks again later instead of holding the line open (500 ms rule).
export async function jobStatus(deps: Deps, hh: string, id: string): Promise<JobView> {
  try {
    const c = await getChallenge(deps, hh, id);
    if (c) {
      if (c.status === 'open') return { job_id: id, status: (c.expiresAt <= (deps.now ?? Date.now)() ? 'failed' : 'waiting'), say: c.expiresAt <= (deps.now ?? Date.now)() ? 'That ran out of time.' : 'Waiting for your phone.', done: false };
      const r = c.result;
      return { job_id: id, status: r?.done ? 'done' : 'failed', say: r?.reason ?? 'Done.', done: !!r?.done };
    }
    const j = await deps.store.get(Store.hk(hh), `JOB#${id}`);
    if (j) return { job_id: id, status: j.status, say: j.say, done: j.status === 'done' };
    return { job_id: id, status: 'unknown', say: "I can't find that.", done: false };
  } catch {
    return { job_id: id, status: 'failed', say: 'Something went wrong. Ask an adult.', done: false };
  }
}
