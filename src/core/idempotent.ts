import { createHash } from 'node:crypto';
import { makeIdempotent, IdempotencyConfig } from '@aws-lambda-powertools/idempotency';
import { DynamoDBPersistenceLayer } from '@aws-lambda-powertools/idempotency/dynamodb';
import type { Deps } from './request-action.js';
import { requestAction } from './request-action.js';
import { getSession } from './household.js';
import { formatLocal } from './time.js';
import { T } from '../text.js';
import type { ActionArgs, ActionResult } from './types.js';

interface Payload {
  hh: string;
  args: ActionArgs;
  idemKey: string;
}

// Alexa may retry a call. Same request_id (or, with none, the same person asking the same thing) → one action, same answer.
// A request with an id is remembered for an hour; without one, for 5 seconds.
const wrappers = new WeakMap<object, { withId: (p: Payload) => Promise<ActionResult>; noId: (p: Payload) => Promise<ActionResult> }>();

function build(deps: Deps) {
  const layer = () =>
    new DynamoDBPersistenceLayer({
      tableName: deps.store.table,
      keyAttr: 'pk',
      sortKeyAttr: 'sk',
      staticPkValue: 'IDEMP',
      expiryAttr: 'ttl',
      awsSdkV3Client: deps.store.client,
    });
  const mk = (seconds: number) => {
    const config = new IdempotencyConfig({ eventKeyJmesPath: 'idemKey', expiresAfterSeconds: seconds });
    // not called by Lambda's handler wrapper here, so give it the time budget a request really has (29 s)
    config.registerLambdaContext({ getRemainingTimeInMillis: () => 29_000 } as any);
    // JSON round-trip: the store cannot hold `undefined` values
    return makeIdempotent(async (p: Payload) => JSON.parse(JSON.stringify(await requestAction(deps, p.hh, p.args))) as ActionResult, { persistenceStore: layer(), config });
  };
  return { withId: mk(3600), noId: mk(5) }; // without an id, only a retry within seconds counts as the same request
}

export async function requestActionOnce(deps: Deps, hh: string, args: ActionArgs): Promise<ActionResult> {
  const now = (deps.now ?? Date.now)();
  try {
    const session = await getSession(deps.store, hh, now);
    const person = session?.personId ?? 'guest';
    const idemKey = createHash('sha256').update(JSON.stringify([hh, person, args.request_id ? args.request_id : args])).digest('hex');
    let w = wrappers.get(deps.store);
    if (!w) wrappers.set(deps.store, (w = build(deps)));
    return await (args.request_id ? w.withId : w.noId)({ hh, args, idemKey });
  } catch (e) {
    if (process.env.HG_DEBUG) console.error('idempotent wrapper failed', e);
    // already-in-progress, or the store failed: hold. Never allow, never run twice.
    return { outcome: 'held', reason: T.busy, done: false, say: T.busy, at: new Date(now).toISOString(), at_local: formatLocal(now, 'America/New_York') };
  }
}
