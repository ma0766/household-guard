import type { Deps } from './request-action.js';
import type { ActionArgs } from './types.js';
import { execSimHome, SIM_HOME } from '../connectors/sim-home.js';
import { T } from '../text.js';

export interface Executed {
  done: boolean;
  reason: string;
}

// The only place a connector is called. Callers have already been through the rules (and any confirmations).
export async function executeAction(deps: Deps, hh: string, _personId: string, args: ActionArgs): Promise<Executed> {
  if (args.service === SIM_HOME) {
    await execSimHome(deps.store, hh, args.action, args.item, args.value);
    return { done: true, reason: T.done(args.action, args.item, args.value) };
  }
  return { done: false, reason: T.notReady };
}
