import { defaultStore } from './core/store.js';
import { makeDeps } from './core/deps.js';
import { handleGatewayCall } from './gateway/handler.js';

// AgentCore Gateway → this Lambda (a tool target). The Gateway's own sign-in decides who may call it at all; WHICH household is
// answered is fixed by this stage's setting, never by anything in the call.
const deps = makeDeps(defaultStore());
export const handler = async (event: unknown, context: { clientContext?: { custom?: { bedrockAgentCoreToolName?: string } } }) => {
  const tool = context?.clientContext?.custom?.bedrockAgentCoreToolName ?? 'request_action';
  return handleGatewayCall(deps, process.env.HG_GATEWAY_HOUSEHOLD ?? 'gateway', tool, event);
};
