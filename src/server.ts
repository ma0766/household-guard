import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleMcp } from './mcp/server.js';
import { authenticate, mintToken } from './auth.js';
import { allow, callerOf, LIMITS } from './ratelimit.js';
import { oidcConfig } from './oidc.js';
import { APPROVE_PAGE } from './phone/approve-page.js';
import { Store } from './core/store.js';
import { makeDeps } from './core/deps.js';
import { handlePhone } from './phone/routes.js';
import type { Deps } from './core/request-action.js';
import { defaultRepairer, healthCheck } from './connectors/healing.js';
import { siteBuilderOf } from './sites/job.js';
import type { StandInSiteBuilder } from './sites/builder.js';
import { handleHubWebhook } from './hub/capability.js';
import { defaultHub, type StandInHub } from './hub/hub.js';
import { localOutbox } from './notify/notify.js';
import { setRideState } from './connectors/mock-ride.js';
import { getSession, loadHousehold } from './core/household.js';
import { planPage } from './projects/projects.js';

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
  const want = url.searchParams.get('hh') ?? '';
  // 'service' and 'gateway' belong to the service sign-in and the gateway door: the open demo sign-in can never mint a key for them
  const hh = /^[a-z0-9-]{1,32}$/.test(want) && !['service', 'gateway'].includes(want) ? want : 'demo';
  return { token: mintToken('demo', 86400, hh), phones: Object.fromEntries(['mom', 'dad', 'maya'].map((p) => [p, mintToken(p, 86400, hh, 'phone')])) };
}

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const path = normalize(new URL(req.url ?? '/', 'http://x').pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(WEB_ROOT, path === '/' ? 'index.html' : path);
  if (!file.startsWith(WEB_ROOT)) {
    res.writeHead(403).end();
    return;
  }
  try {
    let data = await readFile(file);
    // With a family-account sign-in server the page shows the sign-in panel from the very first paint (no jump when the script learns about it)
    const e = process.env;
    if (file.endsWith('index.html') && e.HG_OIDC_AUTHORIZE_URL && e.HG_OIDC_TOKEN_URL && e.HG_OIDC_WEB_CLIENT_ID) data = Buffer.from(data.toString('utf8').replace('<body>', '<body class="has-sign-in">'));
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
  'A guest profile is made only by an adult, with a tap on their own phone. It ends after the last day.',
  'The log of what happened is kept for 90 days, then it is deleted.',
  'PINs are stored scrambled. We never store a PIN as typed.',
  'We keep what we need to apply your house rules: names, roles, limits, and the log.',
  'We never sell or share it. This note is not legal advice.',
].join('\n');

// The stand-in for the app's own sign-in page: "Allow" finishes the connection for the person the link was made for.
const STANDIN_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect an app</title>
<style>body{font:18px/1.4 system-ui,sans-serif;padding:16px;color:#1d2433;background:#f5f3ec}button{font:inherit;padding:12px 20px;border-radius:10px;border:1px solid #1d2433;background:#1d2433;color:#fff}</style></head>
<body><h1>Connect an app</h1><p data-testid="standin-label"><b>Demo stand-in page.</b> A real app would show its own sign-in here.</p><p>Say yes to let the house use this app for you.</p><button id="go" data-testid="standin-allow">Allow</button><p id="out" data-testid="standin-out"></p>
<script>document.getElementById('go').onclick=function(){fetch(location.pathname,{method:'POST'}).then(function(r){document.getElementById('out').textContent=r.ok?'Connected. You can close this page.':'This link is old.';});};</script></body></html>`;

function sendJson(res: ServerResponse, body: unknown) {
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

// RFC 9728 style metadata: tells a client which resource this is and that a bearer token is required
function protectedResource(req: IncomingMessage) {
  const host = req.headers.host ?? 'localhost';
  const proto = (req.headers['x-forwarded-proto'] as string) ?? (host.startsWith('127.') || host.startsWith('localhost') ? 'http' : 'https');
  return { resource: `${proto}://${host}/mcp`, bearer_methods_supported: ['header'], resource_documentation: `${proto}://${host}/privacy`, authorization_servers: oidcConfig() ? [oidcConfig()!.issuer] : [] };
}

export function createApp(given?: Deps) {
  let deps = given;
  const getDeps = (): Deps => (deps ??= makeDeps());
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    void (async () => {
      try {
        // routes with no sign-in are limited per caller
        const open_ = url.pathname.startsWith('/preview/') || url.pathname.startsWith('/standin/') || url.pathname === '/webhooks/composio' || url.pathname === '/approve';
        if (open_ && !(await allow(getDeps().store, `open#${callerOf(req)}`, LIMITS.publicPerCaller))) return void res.writeHead(429, { 'retry-after': '30' }).end();
        if (url.pathname === '/demo-token' && !(await allow(getDeps().store, `demo#${callerOf(req)}`, LIMITS.demoTokenPerCaller))) return void res.writeHead(429, { 'retry-after': '30' }).end();
        if (url.pathname === '/healthz') return void res.writeHead(200).end('ok');
        if (url.pathname === '/mcp') return await handleMcp(req, res, getDeps());
        // public metadata (no sign-in needed): what this server is, how it signs people in, and what it keeps
        if (url.pathname === '/.well-known/oauth-protected-resource') return sendJson(res, protectedResource(req));
        if (url.pathname === '/.well-known/household-guard.json') return sendJson(res, { name: 'Household Guard', mcp: '/mcp', protocol_versions: ['2025-11-25', '2025-03-26'], tools: 'tools/list', privacy: '/privacy', source: 'MIT licensed, see LICENSE' });
        // how a browser client signs in (no secrets; null when only the demo sign-in exists)
        if (url.pathname === '/config.json') {
          const e = process.env;
          // which parts are practice versions (stand-ins), so the page can say so to anyone watching
          const standIns = [!e.COMPOSIO_API_KEY && 'apps', !(e.WIX_API_KEY && e.WIX_ACCOUNT_ID) && 'site builder', !e.HG_EMAIL_FROM && 'emails'].filter(Boolean);
          return sendJson(res, { stand_ins: standIns, sign_in: e.HG_OIDC_AUTHORIZE_URL && e.HG_OIDC_TOKEN_URL && e.HG_OIDC_WEB_CLIENT_ID ? { authorize_url: e.HG_OIDC_AUTHORIZE_URL, token_url: e.HG_OIDC_TOKEN_URL, client_id: e.HG_OIDC_WEB_CLIENT_ID, scope: 'openid hg/mcp' } : null });
        }
        // apps (S13): the hub tells us a sign-in ran out; and, with no Composio key, the stand-in's own "Allow" page
        if (url.pathname === '/webhooks/composio' && req.method === 'POST') {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const c of req) {
            size += (c as Buffer).length;
            if (size > 65_536) return void res.writeHead(413).end(); // before anything is checked: a big body is refused
            chunks.push(c as Buffer);
          }
          const hd = req.headers;
          const r = await handleHubWebhook(getDeps(), Buffer.concat(chunks).toString('utf8'), { id: hd['webhook-id'] as string | undefined, ts: hd['webhook-timestamp'] as string | undefined, sig: hd['webhook-signature'] as string | undefined });
          return void res.writeHead(r.status, { 'content-type': 'application/json' }).end('{}');
        }
        const sm = url.pathname.match(/^\/standin\/connect\/([A-Za-z0-9~_-]{10,80})$/);
        if (sm && getDeps().hub?.kind !== 'composio') {
          const hub = (getDeps().hub ??= defaultHub(getDeps().store));
          if (hub.kind !== 'stand-in') return void res.writeHead(404).end();
          if (req.method === 'POST') {
            const ok = await (hub as StandInHub).complete(sm[1]);
            return void res.writeHead(ok ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify({ ok }));
          }
          return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'", 'referrer-policy': 'no-referrer' }).end(STANDIN_PAGE);
        }
        // a published preview of a site we built (the stand-in builder); a draft is never served
        const pm = url.pathname.match(/^\/preview\/([A-Za-z0-9_-]{16,40})$/);
        if (url.pathname.startsWith('/preview/')) {
          const b = pm ? siteBuilderOf(getDeps()) : undefined;
          const html = b && 'html' in b ? await (b as StandInSiteBuilder).html(pm![1]) : undefined;
          if (!html) return void res.writeHead(404).end();
          return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'", 'referrer-policy': 'no-referrer' }).end(html);
        }
        // the page an adult opens from the email: it carries its own short-lived key in the link
        if (url.pathname === '/approve') return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'", 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' }).end(APPROVE_PAGE);
        if (url.pathname === '/demo/outbox' && (process.env.HG_LOCAL === '1' || process.env.HG_DEMO === '1')) return sendJson(res, { sent: localOutbox.sent });
        // a project plan: an unguessable address, the plan as plain text, nothing on the page can act
        const plan = url.pathname.match(/^\/plan\/([A-Za-z0-9_-]{1,40})\/([A-Za-z0-9_-]{6,20})\/([A-Za-z0-9_-]{10,40})$/);
        if (plan) {
          const html = await planPage(getDeps(), plan[1], plan[2], plan[3]);
          if (!html) return void res.writeHead(404).end();
          return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'", 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }).end(html);
        }
        if (url.pathname === '/privacy') return void res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(PRIVACY);
        // local demo only: hands out a signed token so the web client can sign in
        if (url.pathname === '/demo-token' && (process.env.HG_LOCAL === '1' || process.env.HG_DEMO === '1')) {
          return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(demoTokens(url)));
        }
        // demo only: the ride service "ships a new version" (price_cents becomes fare_cents), and "check now" runs the health check
        if ((url.pathname === '/demo/break-ride' || url.pathname === '/demo/check-rides') && req.method === 'POST' && (process.env.HG_LOCAL === '1' || process.env.HG_DEMO === '1')) {
          const claims = await authenticate(req);
          if (!claims) return void res.writeHead(401).end();
          if (claims.aud !== 'alexa' || claims.ap || claims.kind === 'service') return void res.writeHead(403).end(); // the demo buttons are for the voice side of a house only
          const d = getDeps();
          if (url.pathname === '/demo/break-ride') {
            // breaking the shared service is for a confirmed adult only (the sign-in alone is open in the demo)
            const sess = await getSession(d.store, claims.hh, Date.now());
            const who = sess && (await loadHousehold(d.store, claims.hh)).people.find((p) => p.id === sess.personId);
            if (!who || who.role !== 'adult') return void res.writeHead(403, { 'content-type': 'application/json' }).end('{"error":"adults only"}');
            await setRideState(d.store, claims.hh, { renamed: true });
          }
          const full = url.pathname === '/demo/check-rides' ? await healthCheck(d, claims.hh, defaultRepairer()) : { ok: true };
          if ('detail' in full && full.detail) console.error('health check detail:', full.detail); // the cause stays in our logs; the page gets only a plain sentence (it once showed a cloud role name)
          const { detail: _detail, ...out } = full as Record<string, unknown>;
          return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
        }
        // demo only: "nobody has confirmed" — so a guest can speak after a family member's turn ended
        if (url.pathname === '/demo/guest' && req.method === 'POST' && (process.env.HG_LOCAL === '1' || process.env.HG_DEMO === '1')) {
          const claims = await authenticate(req);
          if (!claims) return void res.writeHead(401).end();
          if (claims.aud !== 'alexa' || claims.ap || claims.kind === 'service') return void res.writeHead(403).end(); // the demo buttons are for the voice side of a house only
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
