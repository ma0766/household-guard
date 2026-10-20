import type { Deps } from './request-action.js';
import type { ActionArgs } from './types.js';
import { execSimHome, SIM_HOME } from '../connectors/sim-home.js';
import { T } from '../text.js';
import { createJob } from '../jobs/worker.js';

export interface PurchaseMeta {
  jobId: string;
  reservationId: string;
  amountCents: number;
  optionId?: string;
  replacesApprovalId?: string;
  savedCents?: number;
}

export interface Executed {
  done: boolean;
  reason: string;
  jobId?: string;
}

// The only place a connector is called. Callers have already been through the rules (and any confirmations).
export async function executeAction(deps: Deps, hh: string, personId: string, args: ActionArgs, meta?: Record<string, unknown>): Promise<Executed> {
  if (meta?.purchase) {
    // money never moves in the reply path: it becomes a job for the worker (500 ms rule)
    const p = meta.purchase as PurchaseMeta;
    await createJob(deps, hh, { id: p.jobId, personId, service: args.service, item: args.item, optionId: p.optionId, amountCents: p.amountCents, reservationId: p.reservationId, replacesApprovalId: p.replacesApprovalId, savedCents: p.savedCents });
    return { done: false, reason: T.booking, jobId: p.jobId };
  }
  if (args.service === SIM_HOME) {
    await execSimHome(deps.store, hh, args.action, args.item, args.value);
    return { done: true, reason: T.done(args.action, args.item, args.value) };
  }
  return { done: false, reason: T.notReady };
}
