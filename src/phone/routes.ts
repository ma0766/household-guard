import type { IncomingMessage, ServerResponse } from 'node:http';
import { bearerOf, originAllowed, readToken } from '../auth.js';
import type { Deps } from '../core/request-action.js';
import { phoneConfirm, phoneInbox } from '../identity/confirm.js';
import { ensureSeeded } from '../core/household.js';
import { approveRequest } from '../approvals/approvals.js';

// A person's own phone talks to us here — NOT through Alexa. In the hackathon the web client simulates one phone per person.
export async function handlePhone(req: IncomingMessage, res: ServerResponse, deps: Deps): Promise<void> {
  const send = (s: number, b: unknown) => void res.writeHead(s, { 'content-type': 'application/json' }).end(JSON.stringify(b));
  if (!originAllowed(req)) return send(403, { error: 'Origin not allowed' });
  const claims = readToken(bearerOf(req));
  if (!claims) return send(401, { error: 'Sign in first' });
  // a phone only speaks for its own person — the voice-side token (which Alexa and the web log can see) does not work here
  const m = new URL(req.url ?? '/', 'http://x').pathname.match(/^\/phone\/([a-z0-9-]+)\/(inbox|confirm|approve|reject)$/);
  if (!m) return send(404, { error: 'Not found' });
  const [, person, what] = m;
  if (claims.aud !== 'phone' || claims.sub !== person) return send(403, { error: 'That is not your phone' });
  await ensureSeeded(deps.store, claims.hh);
  if (what === 'inbox' && req.method === 'GET') return send(200, await phoneInbox(deps, claims.hh, person));
  if (what === 'confirm' && req.method === 'POST') {
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw || '{}');
    return send(200, await phoneConfirm(deps, claims.hh, person, { challenge_id: String(body.challenge_id), number: Number(body.number) }));
  }
  if ((what === 'approve' || what === 'reject') && req.method === 'POST') {
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw || '{}');
    return send(200, await approveRequest(deps, claims.hh, person, String(body.approval_id), { number: Number(body.number), decision: what === 'reject' ? 'no' : 'yes', method: 'phone' }));
  }
  return send(405, { error: 'Not allowed' });
}
