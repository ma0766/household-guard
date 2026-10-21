import { defaultStore } from './core/store.js';
import { makeDeps } from './core/deps.js';
import { BedrockRepairer, healAll } from './connectors/healing.js';

// EventBridge → this Lambda, every 5 minutes. A safe read of each service; repair only when the answer stopped fitting.
const deps = makeDeps(defaultStore());
export const handler = async () => {
  const out = await healAll(deps, new BedrockRepairer());
  console.log(JSON.stringify({ heal: out }));
  return out;
};
