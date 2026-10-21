import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { verifyOidc } from './oidc.js';

// HMAC-signed bearer: payload.signature — stateless, so every Lambda can verify with no lookup
const secret = () => process.env.HG_TOKEN_SECRET || 'local-dev-secret-not-for-prod';

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');

// aud 'alexa' = the voice side (MCP). aud 'phone' = one person's own phone; sub is that person.
export function mintToken(sub = 'demo', ttlSeconds = 60 * 60 * 24, hh = 'demo', aud: 'alexa' | 'phone' = 'alexa'): string {
  const payload = b64(JSON.stringify({ sub, hh, aud, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export interface Claims { sub: string; hh: string; aud: 'alexa' | 'phone'; exp: number; ap?: string; kind?: 'user' | 'service' } // ap: a phone link made for ONE approval

// The link in an approval email: one adult's phone, for ONE approval, ending when that approval ends.
export function mintLinkToken(person: string, hh: string, approvalId: string, ttlSeconds: number): string {
  const payload = b64(JSON.stringify({ sub: person, hh, aud: 'phone', ap: approvalId, exp: Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(ttlSeconds)) }));
  return `${payload}.${createHmac('sha256', secret()).update(payload).digest('base64url')}`;
}

export function verifyToken(token: string | undefined): boolean {
  return readToken(token) !== undefined;
}

// returns the household this token belongs to; undefined = not signed in
export function readToken(token: string | undefined): Claims | undefined {
  if (!token) return undefined;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return undefined;
  const want = createHmac('sha256', secret()).update(payload).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return undefined;
  try {
    const c = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof c.exp === 'number' && c.exp > Date.now() / 1000 ? { sub: c.sub, hh: c.hh ?? 'demo', aud: c.aud === 'phone' ? 'phone' : 'alexa', exp: c.exp, ...(typeof c.ap === 'string' ? { ap: c.ap } : {}) } : undefined;
  } catch {
    return undefined;
  }
}

// Who is calling? Our own signed keys (phones, links, the demo sign-in) first, then a family account from the sign-in server.
export async function authenticate(req: IncomingMessage): Promise<Claims | undefined> {
  const t = bearerOf(req);
  return readToken(t) ?? (await verifyOidc(t));
}

export function bearerOf(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
}

// Browsers always send Origin; CLI clients don't. Block only a present-but-foreign Origin (DNS-rebinding guard).
export function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  if (host === req.headers.host) return true;
  const extra = (process.env.HG_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return extra.includes(origin);
}
