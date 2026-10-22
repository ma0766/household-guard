import type { ActionArgs } from './types.js';

// Risk tiers: low = just do it (lights, music, weather, timers, the heat in range, the garage for adults and teens: no tap).
// medium = confirm on your own phone (any purchase). high = your own phone tap, always (unlocking, changing a rule).
export type Tier = 'low' | 'medium' | 'high';

export function tierOf(args: ActionArgs, overCap = false): Tier {
  switch (args.action) {
    case 'unlock':
    case 'build_site':
    case 'set_rule':
      return 'high';
    case 'purchase':
      return overCap ? 'high' : 'medium';
    default:
      return 'low';
  }
}
