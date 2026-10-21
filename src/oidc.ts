import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Claims } from './auth.js';

// Sign-in through an OAuth 2.1 server (Amazon Cognito in AWS). Alexa links ONE account per household, so a signed-in token is the
// voice side only (aud 'alexa'). It can never act as a person's phone. The household comes from the user's group "hh-<household>".
export interface OidcConfig {
  issuer: string; // https://cognito-idp.us-east-1.amazonaws.com/<pool id>
  jwksUri: string;
  clientIds: string[]; // the web client (users) and the service client (client_credentials)
  serviceClientId?: string;
  serviceHousehold?: string; // the household a client_credentials token speaks for
}

export function oidcConfig(env: NodeJS.ProcessEnv = process.env): OidcConfig | undefined {
  const issuer = env.HG_OIDC_ISSUER;
  if (!issuer) return undefined;
  return {
    issuer,
    jwksUri: env.HG_OIDC_JWKS_URI || `${issuer}/.well-known/jwks.json`,
    clientIds: (env.HG_OIDC_CLIENT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    serviceClientId: env.HG_OIDC_SERVICE_CLIENT_ID || undefined,
    serviceHousehold: env.HG_SERVICE_HOUSEHOLD || undefined,
  };
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function keysFor(c: OidcConfig) {
  let k = keySets.get(c.jwksUri);
  if (!k) keySets.set(c.jwksUri, (k = createRemoteJWKSet(new URL(c.jwksUri), { cooldownDuration: 30_000, timeoutDuration: 5_000 })));
  return k;
}

// Any doubt → undefined (not signed in). Never throws.
export async function verifyOidc(token: string | undefined): Promise<Claims | undefined> {
  const c = oidcConfig();
  if (!c || !token || token.split('.').length !== 3) return undefined;
  try {
    // signature (RS256 only: no HS256 or none tricks), issuer, expiry and not-before are all checked here
    const p = (await jwtVerify(token, keysFor(c), { issuer: c.issuer, algorithms: ['RS256'] })).payload as Record<string, unknown>;
    if (p.token_use !== 'access') return undefined; // an ID token is not a key to the house
    // the token must have been issued for the house (scope hg/mcp). A direct-login token (no custom scope) is only taken when this stage opts in.
    const scopes = String(p.scope ?? '').split(' ');
    if (!scopes.includes('hg/mcp') && !(process.env.HG_OIDC_ALLOW_DIRECT === '1' && scopes.includes('aws.cognito.signin.user.admin'))) return undefined;
    const client = String(p.client_id ?? '');
    if (!c.clientIds.includes(client) && client !== c.serviceClientId) return undefined;
    const groups = Array.isArray(p['cognito:groups']) ? (p['cognito:groups'] as unknown[]).map(String) : [];
    const houses = groups.filter((g) => /^hh-[a-z0-9-]{1,32}$/.test(g)).map((g) => g.slice(3));
    const exp = Number(p.exp);
    if (!Number.isFinite(exp)) return undefined;
    if (client === c.serviceClientId && !groups.length) {
      return c.serviceHousehold ? { sub: String(p.sub ?? client), hh: c.serviceHousehold, aud: 'alexa', exp, kind: 'service' } : undefined;
    }
    if (houses.length !== 1) return undefined; // not in exactly one household: no guessing
    return { sub: String(p.sub ?? 'user'), hh: houses[0], aud: 'alexa', exp, kind: 'user' };
  } catch {
    return undefined;
  }
}
