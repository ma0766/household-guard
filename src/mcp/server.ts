import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { authenticate, originAllowed } from '../auth.js';
import { allow, LIMITS } from '../ratelimit.js';
import type { Deps } from '../core/request-action.js';
import { requestActionOnce } from '../core/idempotent.js';
import { confirmIdentity } from '../identity/confirm.js';
import { jobStatus } from '../core/jobs.js';
import { approveRequest } from '../approvals/approvals.js';
import { getSession } from '../core/household.js';
import { T } from '../text.js';
import { householdStatus, voiceSummary, recentOrders } from '../audit/report.js';
import { readAudit } from '../audit/audit.js';
import { approvalsHtml, ordersHtml, timelineHtml } from '../audit/views.js';
import { openApprovals } from '../approvals/approvals.js';
import { myRules, proposeRule, rulesHtml } from '../rules/change.js';
import type { RuleChange } from '../rules/templates.js';
import { ensureSeeded, loadHousehold } from '../core/household.js';
import { connectService, findCapability } from '../hub/capability.js';
import { APP_HTML, APP_META, APP_MIME, APP_URI, cardsOf, rowsOf, type ScreenData } from './apps.js';

// Fixed facade: tool names never change, so nothing behind them needs a redeploy to Alexa.
// Who is asking, from the confirmed session only. No session → undefined (treated as a guest).
async function viewer(deps: Deps, hh: string): Promise<{ id: string; role: string } | undefined> {
  const s = await getSession(deps.store, hh, (deps.now ?? Date.now)());
  if (!s) return undefined;
  const me = (await loadHousehold(deps.store, hh)).people.find((p) => p.id === s.personId);
  return me && me.role !== 'guest' ? { id: me.id, role: me.role } : undefined;
}

export function buildMcpServer(deps: Deps, hh: string): McpServer {
  const server = new McpServer({ name: 'household-guard', version: '0.1.0' });
  server.registerTool('household_status', { description: 'Who is in the house and what is waiting.', inputSchema: {} }, async () => {
    try {
      await ensureSeeded(deps.store, hh);
      const sess = await getSession(deps.store, hh, (deps.now ?? Date.now)()); // who is talking, if anyone has confirmed
      const r = await householdStatus(deps, hh, sess?.personId);
      return { content: [{ type: 'text', text: r.say }], structuredContent: r as unknown as Record<string, unknown> };
    } catch {
      return { content: [{ type: 'text', text: T.oops }], structuredContent: { say: T.oops } };
    }
  });
  // NOTE: no person / speaker / user argument — who is speaking comes only from a confirmed session.
  server.registerTool(
    'request_action',
    {
      description: 'Ask the house to do something (lights, doors, rides). The house rules are checked first.',
      inputSchema: {
        service: z.string().max(60).describe('Which service, e.g. sim-home'),
        action: z.string().max(40).describe('What to do, e.g. light, unlock, thermostat, garage, purchase'),
        item: z.string().max(300).optional().describe('What it is about, e.g. front door'),
        value: z.union([z.string().max(120), z.number()]).optional().describe('e.g. off, or 72'),
        option_id: z.string().max(120).optional().describe('Which option, e.g. shared'),
        replaces: z.string().max(120).optional().describe('The held request this one replaces (taking the cheaper option)'),
        request_id: z.string().max(120).optional().describe('Same id on a retry = the action happens once'),
      },
    },
    async (args) => {
      const r = await requestActionOnce(deps, hh, args);
      return { content: [{ type: 'text', text: r.say }], structuredContent: r as Record<string, unknown> };
    },
  );
  server.registerTool(
    'confirm_identity',
    {
      description: 'Say who is talking. People with a phone get a number to match on their own phone. People without one give a PIN.',
      inputSchema: { name: z.string().max(120).describe('The name the speaker gave'), pin: z.string().max(120).optional().describe('4-digit PIN, only for people without a phone') },
    },
    async (args) => {
      const r = await confirmIdentity(deps, hh, args);
      return { content: [{ type: 'text', text: r.say }], structuredContent: r as unknown as Record<string, unknown> };
    },
  );
  server.registerTool(
    'approve_request',
    {
      description: 'An adult says yes (or no) to a held request by giving the number Alexa said. Needs a phone-confirmed adult.',
      inputSchema: { approval_id: z.string().max(120), number: z.number().int().min(0).max(1000).optional(), decision: z.enum(['yes', 'no']).optional() },
    },
    async (a) => {
      const s = await getSession(deps.store, hh, (deps.now ?? Date.now)());
      const r = s ? await approveRequest(deps, hh, s.personId, a.approval_id, { number: a.number, decision: a.decision, method: s.method === 'phone' ? 'phone' : 'pin', voiceConfirmedAt: s.confirmedAt }) : { status: 'not_adult', say: T.whoAreYou };
      return { content: [{ type: 'text', text: r.say }], structuredContent: r as unknown as Record<string, unknown> };
    },
  );
  server.registerTool(
    'audit_log',
    {
      description: 'What happened at home? Answers like "What did the kids buy this week?" in a few short sentences, totals first.',
      inputSchema: { who: z.string().max(120).optional().describe('kids, everyone, or a name'), when: z.string().max(120).optional().describe('today, this week, or last week') },
    },
    async (a) => {
      try {
        await ensureSeeded(deps.store, hh);
        const v = await viewer(deps, hh);
        if (!v) return { content: [{ type: 'text', text: T.whoAreYou }], structuredContent: { say: T.whoAreYou } };
        // adults see the whole house; everyone else sees only their own
        const r = await voiceSummary(deps, hh, { ...a, who: v.role === 'adult' ? a.who : v.id });
        return { content: [{ type: 'text', text: r.say }], structuredContent: r as unknown as Record<string, unknown> };
      } catch {
        return { content: [{ type: 'text', text: T.oops }], structuredContent: { say: T.oops } };
      }
    },
  );
  server.registerTool(
    'show_on_screen',
    {
      description: 'Show a screen: the approval card, recent buys, or what happened. Filter by person or day.',
      _meta: APP_META,
      inputSchema: { view: z.enum(['approvals', 'orders', 'timeline', 'rules', 'my_rules']), person: z.string().max(120).optional(), day: z.string().max(120).optional().describe('YYYY-MM-DD') },
    },
    async (a) => {
      try {
        await ensureSeeded(deps.store, hh);
        const v = await viewer(deps, hh);
        if (!v) return { _meta: APP_META, content: [{ type: 'text', text: T.whoAreYou }], structuredContent: { say: T.whoAreYou } };
        const mine = v.role !== 'adult'; // kids see only their own things
        if (a.view === 'my_rules') {
          const r = await myRules(deps, hh);
          return { _meta: APP_META, content: [{ type: 'text', text: r.say }], structuredContent: { view: a.view, say: r.say, html: `<!doctype html><html lang="en"><meta charset="utf-8"><title>My rules</title><p style="font:16px system-ui">${r.say}</p>` } };
        }
        if (a.view === 'rules') {
          const h = await loadHousehold(deps.store, hh);
          return { _meta: APP_META, content: [{ type: 'text', text: 'Here are the house rules.' }], structuredContent: { view: a.view, html: rulesHtml(h.rules, h.people) } };
        }
        let html: string;
        let data: ScreenData;
        if (a.view === 'approvals') {
          const list = (await openApprovals(deps, hh)).filter((x) => !mine || x.personId === v.id);
          html = approvalsHtml(list);
          data = { view: 'approvals', cards: cardsOf(list, !mine) };
        } else if (a.view === 'orders') {
          const list = (await recentOrders(deps.store, hh, 50)).filter((e) => !mine || e.person === v.id).slice(0, 10);
          html = ordersHtml(list);
          data = { view: 'orders', rows: rowsOf(list) };
        } else {
          const list = await readAudit(deps.store, hh, { person: mine ? v.id : a.person, day: a.day, limit: 50 });
          html = timelineHtml(list);
          data = { view: 'timeline', rows: rowsOf(list) };
        }
        return { _meta: APP_META, content: [{ type: 'text', text: `Here is the ${a.view} screen.` }], structuredContent: { view: a.view, html, data } };
      } catch {
        return { _meta: APP_META, content: [{ type: 'text', text: T.oops }], structuredContent: { say: T.oops } };
      }
    },
  );
  server.registerTool(
    'find_capability',
    { description: 'Can the house do this? Looks for an app (like music) and says if the speaker has connected it.', inputSchema: { query: z.string().max(60).describe('What the speaker wants, like "music"') } },
    async ({ query }) => {
      const r = await findCapability(deps, hh, { query });
      return { content: [{ type: 'text', text: r.say }], structuredContent: r as unknown as Record<string, unknown> };
    },
  );
  server.registerTool(
    'connect_service',
    { description: 'Start connecting an app for the speaker. Gives a link and a code to scan on their phone.', inputSchema: { toolkit: z.string().max(40).describe('The app, like "spotify"') }, _meta: APP_META },
    async ({ toolkit }) => {
      const r = await connectService(deps, hh, { toolkit });
      const data = r.link ? { view: 'connect', name: r.name, link: r.link, qr: r.qr } : undefined;
      return { content: [{ type: 'text', text: r.say }], structuredContent: { ...(r as unknown as Record<string, unknown>), ...(data ? { data } : {}) } };
    },
  );
  server.registerResource('screen', APP_URI, { title: 'House screen', description: 'Approval card, recent buys, and what happened', mimeType: APP_MIME }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: APP_MIME, text: APP_HTML }],
  }));
  server.registerTool(
    'set_rule',
    {
      description: 'An adult changes a house rule (or undoes the last change). The adult must then confirm on their own phone.',
      inputSchema: {
        template: z.enum(['weekly_limit', 'adults_only', 'allowed_apps', 'must_haves', 'quiet_hours', 'floor', 'private_orders']).optional(),
        roles: z.array(z.enum(['teen', 'child'])).max(2).optional().describe('private_orders: who besides adults may hear order history'),
        person: z.string().max(120).optional(),
        dollars: z.number().optional(),
        actions: z.array(z.string().max(40)).max(20).optional(),
        services: z.array(z.string().max(40)).max(20).optional(),
        bag_included: z.boolean().optional(),
        arrive_by_hour: z.number().nullable().optional(),
        quiet_from_hour: z.number().nullable().optional().describe('Quiet hours start (0-23); null turns them off'),
        quiet_to_hour: z.number().optional().describe('Quiet hours end (0-23)'),
        which: z.enum(['childrenNoUnlock', 'guestsNoBuy']).optional(),
        enabled: z.boolean().optional(),
        undo: z.boolean().optional().describe('Undo the newest change (within 24 hours)'),
      },
    },
    async (a) => {
      let change: RuleChange | undefined;
      if (a.template === 'weekly_limit') change = { template: 'weekly_limit', person: String(a.person ?? '').toLowerCase(), cents: Math.round(Number(a.dollars) * 100) };
      else if (a.template === 'adults_only') change = { template: 'adults_only', actions: a.actions ?? [] };
      else if (a.template === 'allowed_apps') change = { template: 'allowed_apps', services: a.services ?? [] };
      else if (a.template === 'must_haves') change = { template: 'must_haves', bagIncluded: a.bag_included, arriveByHour: a.arrive_by_hour };
      else if (a.template === 'quiet_hours' && a.quiet_from_hour !== undefined) change = { template: 'quiet_hours', fromHour: a.quiet_from_hour, toHour: a.quiet_to_hour };
      else if (a.template === 'private_orders') change = { template: 'private_orders', roles: a.roles ?? [] };
      else if (a.template === 'floor') change = { template: 'floor', which: a.which as 'childrenNoUnlock', enabled: !!a.enabled };
      const r = !change && !a.undo ? { status: 'invalid', say: "I don't know that rule." } : await proposeRule(deps, hh, { change, undo: a.undo });
      return { content: [{ type: 'text', text: r.say }], structuredContent: r as unknown as Record<string, unknown> };
    },
  );
  server.registerTool(
    'job_status',
    { description: 'How is a waiting job going? A finished site comes with a link and a code to scan.', inputSchema: { job_id: z.string().max(120) }, _meta: APP_META },
    async ({ job_id }) => {
      const r = await jobStatus(deps, hh, job_id);
      const { qrOf } = await import('../hub/capability.js');
      const data = r.preview_url ? { view: 'preview', name: r.name ?? 'Your site', link: r.preview_url, qr: qrOf(r.preview_url) } : undefined;
      return { content: [{ type: 'text', text: r.say }], structuredContent: { ...(r as unknown as Record<string, unknown>), ...(data ? { data } : {}) } };
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
  const claims = await authenticate(req);
  if (!claims || claims.aud !== 'alexa') {
    res.setHeader('www-authenticate', 'Bearer');
    return send(res, 401, { error: 'Sign in first' });
  }
  if (!(await allow(deps.store, `mcp#${claims.hh}`, LIMITS.mcpPerHouse))) {
    res.setHeader('retry-after', '30');
    return send(res, 429, { error: 'Too many requests. Wait a little.' });
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
