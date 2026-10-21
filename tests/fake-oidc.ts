import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from 'jose';
import { createHash, randomUUID } from 'node:crypto';

// A small stand-in for the sign-in server: it publishes its keys, signs access tokens like Cognito does, and speaks the
// authorization-code + PKCE flow (so the web client's sign-in can be tested with no AWS).
export interface FakeOidc {
  issuer: string;
  jwksUri: string;
  close(): Promise<void>;
  sign(claims: Record<string, unknown>, opts?: { expiresIn?: string; issuer?: string; key?: CryptoKey; kid?: string }): Promise<string>;
  otherKey(): Promise<CryptoKey>;
}

export async function startFakeOidc(port = 0): Promise<FakeOidc & { server: Server }> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, { challenge: string; hh: string; redirect: string }>();
  let base = '';
  const sign: FakeOidc['sign'] = async (claims, opts = {}) =>
    new SignJWT({ token_use: 'access', client_id: 'web-client', scope: 'hg/mcp', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: opts.kid ?? 'k1' })
      .setIssuer(opts.issuer ?? base)
      .setSubject(String(claims.sub ?? randomUUID()))
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? '1h')
      .sign(opts.key ?? privateKey);

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname === '/.well-known/jwks.json') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [jwk] }));
      if (url.pathname === '/oauth2/authorize') {
        // the "sign-in page": approves at once, as the family named by login_hint
        const redirect = url.searchParams.get('redirect_uri') ?? '';
        if (url.searchParams.get('code_challenge_method') !== 'S256' || !url.searchParams.get('code_challenge')) return void res.writeHead(400).end('PKCE S256 required');
        const code = randomUUID();
        codes.set(code, { challenge: url.searchParams.get('code_challenge')!, hh: url.searchParams.get('login_hint') ?? 'demo', redirect });
        const back = new URL(redirect);
        back.searchParams.set('code', code);
        back.searchParams.set('state', url.searchParams.get('state') ?? '');
        return void res.writeHead(302, { location: back.toString() }).end();
      }
      if (url.pathname === '/oauth2/token' && req.method === 'POST') {
        let raw = '';
        for await (const c of req) raw += c;
        const f = new URLSearchParams(raw);
        const entry = codes.get(f.get('code') ?? '');
        codes.delete(f.get('code') ?? ''); // a code works once
        const verifier = f.get('code_verifier') ?? '';
        const ok = entry && f.get('grant_type') === 'authorization_code' && f.get('redirect_uri') === entry.redirect && createHash('sha256').update(verifier).digest('base64url') === entry.challenge;
        if (!ok) return void res.writeHead(400, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }).end('{"error":"invalid_grant"}');
        const access_token = await sign({ 'cognito:groups': [`hh-${entry.hh}`] });
        return void res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }).end(JSON.stringify({ access_token, token_type: 'Bearer', expires_in: 3600 }));
      }
      res.writeHead(404).end();
    })();
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    server,
    issuer: base,
    jwksUri: `${base}/.well-known/jwks.json`,
    sign,
    otherKey: async () => (await generateKeyPair('RS256')).privateKey,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
