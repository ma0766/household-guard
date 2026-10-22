import type { IncomingMessage, ServerResponse } from 'node:http';
import { authenticate, originAllowed } from '../auth.js';
import { allow, LIMITS } from '../ratelimit.js';
import type { Deps } from '../core/request-action.js';
import { phoneConfirm, phoneInbox } from '../identity/confirm.js';
import { ensureSeeded } from '../core/household.js';
import { answerSuggestion } from '../devices/suggest.js';
import { approveRequest } from '../approvals/approvals.js';

// A person's own phone talks to us here — NOT through Alexa. In the hackathon the web client simulates one phone per person.
export async function handlePhone(req: IncomingMessage, res: ServerResponse, deps: Deps): Promise<void> {
  const send = (s: number, b: unknown) => void res.writeHead(s, { 'content-type': 'application/json' }).end(JSON.stringify(b));
  if (!originAllowed(req)) return send(403, { error: 'Origin not allowed' });
  const claims = await authenticate(req);
  if (!claims) return send(401, { error: 'Sign in first' });
  // a phone only speaks for its own person — the voice-side token (which Alexa and the web log can see) does not work here
  const m = new URL(req.url ?? '/', 'http://x').pathname.match(/^\/phone\/([a-z0-9-]+)\/(inbox|confirm|approve|reject|suggestion)$/);
  if (!m) return send(404, { error: 'Not found' });
  const [, person, what] = m;
  if (claims.aud !== 'phone' || claims.sub !== person) return send(403, { error: 'That is not your phone' });
  if (!(await allow(deps.store, `phone#${claims.hh}#${person}`, LIMITS.phonePerPerson))) return send(429, { error: 'Too many requests. Wait a little.' });
  await ensureSeeded(deps.store, claims.hh);
  if (claims.ap && what === 'confirm') return send(403, { error: 'That link is for one yes or no' }); // an email link can answer ONE request, nothing else
  if (what === 'inbox' && req.method === 'GET') {
    const inbox = await phoneInbox(deps, claims.hh, person, { link: !!claims.ap }); // an email link is that adult's phone, whether or not they have a phone number
    return send(200, claims.ap ? { ...inbox, challenges: [], notices: [], approvals: inbox.approvals.filter((a) => a.id === claims.ap) } : inbox);
  }
  if (what === 'confirm' && req.method === 'POST') {
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw || '{}');
    return send(200, await phoneConfirm(deps, claims.hh, person, { challenge_id: String(body.challenge_id), number: Number(body.number), key: typeof body.key === 'string' ? body.key : undefined }));
  }
  if (what === 'suggestion' && req.method === 'POST') {
    if (claims.ap) return send(403, { error: 'That link is for one yes or no' });
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw || '{}');
    return send(200, await answerSuggestion(deps, claims.hh, person, String(body.id), body.answer === 'yes' ? 'yes' : 'no'));
  }
  if ((what === 'approve' || what === 'reject') && req.method === 'POST') {
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw || '{}');
    if (claims.ap && String(body.approval_id) !== claims.ap) return send(403, { error: 'That link is for one yes or no' });
    return send(200, await approveRequest(deps, claims.hh, person, String(body.approval_id), { number: Number(body.number), decision: what === 'reject' ? 'no' : 'yes', method: 'phone' }));
  }
  return send(405, { error: 'Not allowed' });
}
