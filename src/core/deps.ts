import { defaultStore, type Store } from './store.js';
import { LocalQueue, SqsQueue } from '../queue/queue.js';
import { runJob } from '../jobs/dispatch.js';
import type { Deps } from './request-action.js';
import { defaultHome } from '../connectors/home-assistant.js';
import { defaultRuleParser } from '../rules/sentence.js';
import { defaultPlanner } from '../projects/planner.js';
import { defaultRisk } from '../risk/risk.js';

// Wires the pieces. AWS: SQS + a worker Lambda calls processJob. Local/tests: an in-process queue calls it directly.
export function makeDeps(store: Store = defaultStore(), extra: Partial<Deps> = {}): Deps {
  const deps: Deps = { store, ...extra };
  deps.risk ??= defaultRisk();
  deps.ruleParser ??= defaultRuleParser();
  deps.planner ??= defaultPlanner();
  if (!deps.home) deps.home = defaultHome();
  if (!deps.queue) deps.queue = process.env.HG_QUEUE_URL ? new SqsQueue(process.env.HG_QUEUE_URL) : new LocalQueue((m) => runJob(deps, m));
  return deps;
}
