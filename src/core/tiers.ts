import type { ActionArgs } from './types.js';
import { kindOf } from '../policy/kinds.js';

// Risk tiers come from the KIND of action (src/policy/kinds.ts):
// info and control = low (just do it: lights, music, weather, timers, the heat in range, the garage for adults and teens).
// money = medium (a tap on your own phone). access, acting in your name, adding new powers = high (an adult, with a tap).
export type Tier = 'low' | 'medium' | 'high';

export function tierOf(args: ActionArgs, overCap = false): Tier {
  switch (kindOf(args.action)) {
    case 'access':
    case 'act':
    case 'power':
      return 'high';
    case 'money':
      return overCap ? 'high' : 'medium';
    default:
      return 'low';
  }
}
