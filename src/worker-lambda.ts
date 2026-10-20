import type { SQSEvent } from 'aws-lambda';
import { defaultStore } from './core/store.js';
import { makeDeps } from './core/deps.js';
import { processJob } from './jobs/worker.js';

// SQS → this Lambda. Runs the slow part (risk check, ride booking) off the reply path.
const deps = makeDeps(defaultStore());
export const handler = async (event: SQSEvent) => {
  for (const r of event.Records) {
    const m = JSON.parse(r.body) as { hh: string; jobId: string };
    await processJob(deps, m.hh, m.jobId); // never throws: every failure releases the money and marks the job failed
  }
};
