import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleMcp } from './mcp/server.js';
import { bearerOf, mintToken, readToken } from './auth.js';
import { Store } from './core/store.js';
import { makeDeps } from './core/deps.js';
import { handlePhone } from './phone/routes.js';
import type { Deps } from './core/request-action.js';
import { defaultRepairer, healthCheck } from './connectors/healing.js';
import { setRideState } from './connectors/mock-ride.js';
import { getSession, loadHousehold } from './core/household.js';

const WEB_ROOT = process.env.HG_WEB_ROOT ?? join(fileURLToPath(new URL('..', import.meta.url)), 'dist', 'web');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

// demo sign-in: one voice-side token, plus one token per simulated phone (each phone only speaks for its own person)
function demoTokens(url: URL) {
  const hh = /^[a-z0-9-]{1,32}$/.test(url.searchParams.get('hh') ?? '') ? url.searchParams.get('hh')! : 'demo';
  return { token: mintToken('demo', 86400, hh), phones: Object.fromEntries(['mom', 'maya'].map((p) => [p, mintToken(p, 86400, hh, 'phone')])) };
}

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

export const PRIVACY = [
  'Household Guard privacy note',
  '',
  'We do not store audio. Alexa turns speech into text; we only see the text.',
  'Profiles for children are created only by an adult.',
  'The log of what happened is kept for 90 days, then it is deleted.',
  'PINs are stored scrambled (scrypt). We never store a PIN as typed.',
  'We keep what we need to apply your house rules: names, roles, limits, and the log.',
  'We never sell or share it. This note is not legal advice.',
].join('\n');

function sendJson(res: ServerResponse, body: unknown) {
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

// RFC 9728 style metadata: tells a client which resource this is and that a bearer token is required
function protectedResource(req: IncomingMessage) {
  const host = req.headers.host ?? 'localhost';
  const proto = (req.headers['x-forwarded-proto'] as string) ?? (host.startsWith('127.') || host.startsWith('localhost') ? 'http' : 'https');
  return { resource: `${proto}://${host}/mcp`, bearer_methods_supported: ['header'], resource_documentation: `${proto}://${host}/privacy`, authorization_servers: [] };
}

export function createApp(given?: Deps) {
  let deps = given;
  const getDeps = (): Deps => (deps ??= makeDeps());
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    void (async () => {
      try {
        if (url.pathname === '/healthz') return void res.writeHead(200).end('ok');
        if (url.pathname === '/mcp') return await handleMcp(req, res, getDeps());
        // public metadata (no sign-in needed): what this server is, how it signs people in, and what it keeps
        if (url.pathname === '/.well-known/oauth-protected-resource') return sendJson(res, protectedResource(req));
        if (url.pathname === '/.well-known/household-guard.json') return sendJson(res, { name: 'Household Guard', mcp: '/mcp', protocol_versions: ['2025-11-25', '2025-03-26'], tools: 'tools/list', privacy: '/privacy', source: 'MIT licensed, see LICENSE' });
        if (url.pathname === '/privacy') return void res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(PRIVACY);
        // local demo only: hands out a signed token so the web client can sign in
        if (url.pathname === '/demo-token' && (process.env.HG_LOCAL === '1' || process.env.HG_DEMO === '1')) {
          return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(demoTokens(url)));
        }
        // demo only: the ride service "ships a new version" (price_cents becomes fare_cents), and "check now" runs the health check
        if ((url.pathname === '/demo/break-ride' || url.pathname === '/demo/check-rides') && req.method === 'POST' && (process.env.HG_LOCAL === '1' || process.env.HG_DEMO === '1')) {
          const claims = readToken(bearerOf(req));
          if (!claims) return void res.writeHead(401).end();
          const d = getDeps();
          if (url.pathname === '/demo/break-ride') {
            // breaking the shared service is for a confirmed adult only (the sign-in alone is open in the demo)
            const sess = await getSession(d.store, claims.hh, Date.now());
            const who = sess && (await loadHousehold(d.store, claims.hh)).people.find((p) => p.id === sess.personId);
            if (!who || who.role !== 'adult') return void res.writeHead(403, { 'content-type': 'application/json' }).end('{"error":"adults only"}');
            await setRideState(d.store, claims.hh, { renamed: true });
          }
          const out = url.pathname === '/demo/check-rides' ? await healthCheck(d, claims.hh, defaultRepairer()) : { ok: true };
          return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
        }
        // demo only: "nobody has confirmed" — so a guest can speak after a family member's turn ended
        if (url.pathname === '/demo/guest' && req.method === 'POST' && (process.env.HG_LOCAL === '1' || process.env.HG_DEMO === '1')) {
          const claims = readToken(bearerOf(req));
          if (!claims) return void res.writeHead(401).end();
          await getDeps().store.delete(Store.hk(claims.hh), 'SESSION#current');
          return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
        }
        if (url.pathname.startsWith('/phone/')) return await handlePhone(req, res, getDeps());
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
