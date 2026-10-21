import type { IncomingMessage } from 'node:http';
import { Store } from './core/store.js';

// A counter per key per time window, bumped in ONE conditional write, so parallel callers cannot both slip under the limit.
// If the counter cannot be read, the call is refused (never let through).
export async function allow(store: Store, key: string, limit: number, windowMs = 60_000, now = Date.now()): Promise<boolean> {
  try {
    await store.update({
      Key: { pk: 'RATE', sk: `${key}#${Math.floor(now / windowMs)}` },
      UpdateExpression: 'ADD n :one SET #t = :ttl',
      ConditionExpression: 'attribute_not_exists(n) OR n < :max',
      ExpressionAttributeNames: { '#t': 'ttl' },
      ExpressionAttributeValues: { ':one': 1, ':max': limit, ':ttl': Math.floor(now / 1000) + Math.ceil(windowMs / 1000) + 60 },
    });
    return true;
  } catch {
    return false;
  }
}

// who is calling, for routes that have no sign-in (the Function URL puts the caller's address first in x-forwarded-for)
export function callerOf(req: IncomingMessage): string {
  const f = String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim();
  return (/^[0-9a-fA-F:.]{3,45}$/.test(f) ? f : req.socket.remoteAddress) ?? 'unknown';
}

export const LIMITS = { mcpPerHouse: 300, phonePerPerson: 120, publicPerCaller: 60, demoTokenPerCaller: 20 } as const; // per minute
