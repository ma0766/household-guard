import type { Deps } from './request-action.js';
import type { ActionArgs } from './types.js';
import { HomeUnsure } from '../connectors/home-assistant.js';
import { notifyAdults } from '../identity/guard.js';
import { execSimHome, SIM_HOME } from '../connectors/sim-home.js';
import { randomUUID } from 'node:crypto';
import { startSiteJob } from '../sites/job.js';
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
  if (meta?.site) {
    const jobId = randomUUID().slice(0, 12);
    await startSiteJob(deps, hh, jobId, personId, (meta.site as { item?: string }).item);
    return { done: false, reason: T.siteBuilding, jobId };
  }
  if (args.service === SIM_HOME) {
    // a real home (Home Assistant) if one is set up; an error throws, so the answer becomes a hold and nothing is called "done"
    if (deps.home) {
      try {
        await deps.home.run(args.action, args.item, args.value);
      } catch (e) {
        if (e instanceof HomeUnsure) {
          // we stopped waiting, but the home may have done it: say so, and tell an adult
          await notifyAdults(deps.store, hh, T.homeUnsureNote(args.action), (deps.now ?? Date.now)(), personId, 'Someone').catch(() => undefined);
          return { done: false, reason: T.homeUnsure };
        }
        throw e; // a clear "no": the caller turns it into a hold
      }
      // the home did it. Whatever happens to our own note now, the answer is "done" (the door really moved).
      await execSimHome(deps.store, hh, args.action, args.item, args.value).catch(() => undefined);
      return { done: true, reason: T.done(args.action, args.item, args.value) };
    }
    await execSimHome(deps.store, hh, args.action, args.item, args.value);
    return { done: true, reason: T.done(args.action, args.item, args.value) };
  }
  return { done: false, reason: T.notReady };
}
