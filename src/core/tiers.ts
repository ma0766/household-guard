import type { ActionArgs } from './types.js';

// Risk tiers: low = just do it. medium = confirm on your own phone. high = confirm + (for kids) an adult.
export type Tier = 'low' | 'medium' | 'high';

export function tierOf(args: ActionArgs, overCap = false): Tier {
  switch (args.action) {
    case 'unlock':
    case 'build_site':
    case 'set_rule':
      return 'high';
    case 'garage':
      return 'medium';
    case 'purchase':
      return overCap ? 'high' : 'medium';
    default:
      return 'low';
  }
}
