import type { Deps } from '../core/request-action.js';
import type { JobMessage } from '../queue/queue.js';
import { processJob } from './worker.js';
import { runRuleParse } from '../rules/sentence.js';
import { runProject } from '../projects/projects.js';
import { runSiteJob } from '../sites/job.js';

// One place that knows which kind of job a queue message is.
export const runJob = (deps: Deps, m: JobMessage): Promise<void> => (m.kind === 'site' ? runSiteJob(deps, m.hh, m.jobId) : m.kind === 'rule' ? runRuleParse(deps, m.hh, m.jobId) : m.kind === 'project' ? runProject(deps, m.hh, m.jobId) : processJob(deps, m.hh, m.jobId));
