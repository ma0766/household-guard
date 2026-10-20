import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { bearerOf, originAllowed, readToken } from '../auth.js';
import { requestAction, type Deps } from '../core/request-action.js';

// Fixed facade: tool names never change, so nothing behind them needs a redeploy to Alexa.
export function buildMcpServer(deps: Deps, hh: string): McpServer {
  const server = new McpServer({ name: 'household-guard', version: '0.1.0' });
  server.registerTool(
    'household_status',
    { description: 'Who is in the house and what is waiting.', inputSchema: {} },
    async () => ({
      content: [{ type: 'text', text: 'Your house is quiet. Nothing is waiting.' }],
      structuredContent: { members: [], waiting: 0 },
    }),
  );
  // NOTE: no person / speaker / user argument — who is speaking comes only from a confirmed session.
  server.registerTool(
    'request_action',
    {
      description: 'Ask the house to do something (lights, doors, rides). The house rules are checked first.',
      inputSchema: {
        service: z.string().describe('Which service, e.g. sim-home'),
        action: z.string().describe('What to do, e.g. light, unlock, thermostat, garage, purchase'),
        item: z.string().optional().describe('What it is about, e.g. front door'),
        value: z.union([z.string(), z.number()]).optional().describe('e.g. off, or 72'),
        request_id: z.string().optional().describe('Same id on a retry = the action happens once'),
      },
    },
    async (args) => {
      const r = await requestAction(deps, hh, args);
      return { content: [{ type: 'text', text: r.say }], structuredContent: r as Record<string, unknown> };
    },
  );
  return server;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : undefined;
}

// Stateless Streamable HTTP: a fresh server + transport per request (sessionIdGenerator: undefined)
export async function handleMcp(req: IncomingMessage, res: ServerResponse, deps: Deps): Promise<void> {
  if (!originAllowed(req)) return send(res, 403, { error: 'Origin not allowed' });
  const claims = readToken(bearerOf(req));
  if (!claims) {
    res.setHeader('www-authenticate', 'Bearer');
    return send(res, 401, { error: 'Sign in first' });
  }
  if (req.method !== 'POST') return send(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'POST only' }, id: null });
  let body: unknown;
  try {
    body = await readBody(req);
  } catch {
    return send(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Bad JSON' }, id: null });
  }
  const server = buildMcpServer(deps, claims.hh);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
