import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { bearerOf, originAllowed, verifyToken } from '../auth.js';

// Fixed facade: tool names never change, so nothing behind them needs a redeploy to Alexa.
export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: 'household-guard', version: '0.1.0' });
  server.registerTool(
    'household_status',
    { description: 'Who is in the house and what is waiting.', inputSchema: {} },
    async () => ({
      content: [{ type: 'text', text: 'Your house is quiet. Nothing is waiting.' }],
      structuredContent: { members: [], waiting: 0 },
    }),
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
export async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!originAllowed(req)) return send(res, 403, { error: 'Origin not allowed' });
  if (!verifyToken(bearerOf(req))) {
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
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
