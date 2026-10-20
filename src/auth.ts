import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

// HMAC-signed bearer: payload.signature — stateless, so every Lambda can verify with no lookup
const secret = () => process.env.HG_TOKEN_SECRET || 'local-dev-secret-not-for-prod';

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');

export function mintToken(sub = 'demo', ttlSeconds = 60 * 60 * 24, hh = 'demo'): string {
  const payload = b64(JSON.stringify({ sub, hh, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export interface Claims { sub: string; hh: string; exp: number }

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
    return typeof c.exp === 'number' && c.exp > Date.now() / 1000 ? { sub: c.sub, hh: c.hh ?? 'demo', exp: c.exp } : undefined;
  } catch {
    return undefined;
  }
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
