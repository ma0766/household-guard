import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleMcp } from './mcp/server.js';
import { mintToken } from './auth.js';

const WEB_ROOT = process.env.HG_WEB_ROOT ?? join(fileURLToPath(new URL('..', import.meta.url)), 'dist', 'web');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const path = normalize(new URL(req.url ?? '/', 'http://x').pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(WEB_ROOT, path === '/' ? 'index.html' : path);
  if (!file.startsWith(WEB_ROOT)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

export function createApp() {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    void (async () => {
      try {
        if (url.pathname === '/healthz') return void res.writeHead(200).end('ok');
        if (url.pathname === '/mcp') return await handleMcp(req, res);
        // local demo only: hands out a signed token so the web client can sign in
        if (url.pathname === '/demo-token' && (process.env.HG_LOCAL === '1' || process.env.HG_DEMO === '1')) {
          return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ token: mintToken() }));
        }
        return await serveStatic(req, res);
      } catch {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Something went wrong.' }));
      }
    })();
  });
}

if (!process.env.AWS_LAMBDA_FUNCTION_NAME && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 8016);
  createApp().listen(port, process.env.HG_HOST ?? '127.0.0.1', () => console.log(`Household Guard on :${port}`));
}
