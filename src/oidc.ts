import { JwtRsaVerifier } from 'aws-jwt-verify';
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

const verifiers = new Map<string, ReturnType<typeof JwtRsaVerifier.create>>();
function verifierFor(c: OidcConfig) {
  const key = `${c.issuer}|${c.jwksUri}`;
  let v = verifiers.get(key);
  if (!v) verifiers.set(key, (v = JwtRsaVerifier.create({ issuer: c.issuer, audience: null, jwksUri: c.jwksUri })));
  return v;
}

// Any doubt → undefined (not signed in). Never throws.
export async function verifyOidc(token: string | undefined): Promise<Claims | undefined> {
  const c = oidcConfig();
  if (!c || !token || token.split('.').length !== 3) return undefined;
  try {
    const p = (await verifierFor(c).verify(token)) as Record<string, unknown>; // signature, issuer, expiry, not-before
    if (p.token_use !== 'access') return undefined; // an ID token is not a key to the house
    const client = String(p.client_id ?? '');
    if (!c.clientIds.includes(client) && client !== c.serviceClientId) return undefined;
    const groups = Array.isArray(p['cognito:groups']) ? (p['cognito:groups'] as unknown[]).map(String) : [];
    const houses = groups.filter((g) => /^hh-[a-z0-9-]{1,32}$/.test(g)).map((g) => g.slice(3));
    const exp = Number(p.exp);
    if (!Number.isFinite(exp)) return undefined;
    if (client === c.serviceClientId && !groups.length) {
      return c.serviceHousehold ? { sub: String(p.sub ?? client), hh: c.serviceHousehold, aud: 'alexa', exp } : undefined;
    }
    if (houses.length !== 1) return undefined; // not in exactly one household: no guessing
    return { sub: String(p.sub ?? 'user'), hh: houses[0], aud: 'alexa', exp };
  } catch {
    return undefined;
  }
}
