import type { Deps } from '../core/request-action.js';
import { requestActionOnce } from '../core/idempotent.js';
import type { ActionResult } from '../core/types.js';
import { T } from '../text.js';

// The AgentCore Gateway (S16) calls us as a tool target. It is a second front door to the SAME decision: nothing here decides,
// it only checks the shape of the call and hands it to the one place that does. Off unless the stage switches it on.
export const gatewayEnabled = (env: NodeJS.ProcessEnv = process.env) => env.HG_GATEWAY === 'agentcore';

// the only things a gateway call may carry. There is NO person or speaker field, here or in the tool's published shape.
const ALLOWED = new Set(['service', 'action', 'item', 'value', 'option_id', 'request_id', 'replaces']);
const held = (reason: string, outcome: 'held' | 'denied' = 'denied'): ActionResult => ({ outcome, reason, say: reason, done: false, at: new Date().toISOString(), at_local: '' });

export async function handleGatewayCall(deps: Deps, hh: string, toolName: string, input: unknown): Promise<ActionResult> {
  try {
    const tool = String(toolName ?? '').split('___').pop();
    if (tool !== 'request_action') return held(T.cantDo); // one tool is published; anything else is refused
    if (!input || typeof input !== 'object' || Array.isArray(input)) return held(T.cantDo);
    const a = input as Record<string, unknown>;
    for (const k of Object.keys(a)) if (!ALLOWED.has(k)) return held(T.cantDo); // a "person" (or anything unknown) is never accepted
    if (typeof a.service !== 'string' || typeof a.action !== 'string' || a.service.length > 60 || a.action.length > 40) return held(T.cantDo);
    for (const k of ['item', 'option_id', 'request_id', 'replaces']) if (a[k] !== undefined && (typeof a[k] !== 'string' || (a[k] as string).length > 300)) return held(T.cantDo);
    if (a.value !== undefined && typeof a.value !== 'string' && typeof a.value !== 'number') return held(T.cantDo);
    return await requestActionOnce(deps, hh, a as never);
  } catch {
    return held(T.oops, 'held'); // any error is a hold
  }
}

// the shape the Gateway publishes for the tool (no person field)
export const TOOL_SCHEMA = [
  {
    name: 'request_action',
    description: 'Ask the house to do something (lights, doors, a ride, an app). The house decides by its own rules.',
    inputSchema: {
      type: 'object',
      properties: { service: { type: 'string' }, action: { type: 'string' }, item: { type: 'string' }, value: { type: 'string' }, option_id: { type: 'string' }, request_id: { type: 'string' }, replaces: { type: 'string' } },
      required: ['service', 'action'],
    },
  },
];
