import { defaultStore, type Store } from './store.js';
import { LocalQueue, SqsQueue } from '../queue/queue.js';
import { processJob } from '../jobs/worker.js';
import type { Deps } from './request-action.js';
import { defaultRisk } from '../risk/risk.js';

// Wires the pieces. AWS: SQS + a worker Lambda calls processJob. Local/tests: an in-process queue calls it directly.
export function makeDeps(store: Store = defaultStore(), extra: Partial<Deps> = {}): Deps {
  const deps: Deps = { store, ...extra };
  deps.risk ??= defaultRisk();
  if (!deps.queue) deps.queue = process.env.HG_QUEUE_URL ? new SqsQueue(process.env.HG_QUEUE_URL) : new LocalQueue((m) => processJob(deps, m.hh, m.jobId));
  return deps;
}
