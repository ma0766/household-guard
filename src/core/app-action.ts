import type { Deps } from './request-action.js';
import { result } from './request-action.js';
import type { ActionArgs, ActionResult, Person } from './types.js';
import { hubOf, stateOf } from '../hub/capability.js';
import { SLUG, userIdOf } from '../hub/hub.js';
import { Store } from './store.js';
import { notifyAdults } from '../identity/guard.js';
import { T } from '../text.js';

// A person asks an app they connected to do something ("play jazz"). The rules already said yes (the app is allowed, the
// person is not a guest). The app acts as THAT person: userID household:person. The app's reply is never read for a decision
// and never repeated: only our own words and the person's own request (trimmed) go back.
const plain = (s: string) => (s.split(/[\r\n]/)[0] ?? '').replace(/[^A-Za-z0-9 ,.'-]/g, '').trim().slice(0, 40);

export async function handleAppAction(deps: Deps, hh: string, c: { person: Person; args: ActionArgs; tz: string; now: number; base: Record<string, unknown> }): Promise<ActionResult> {
  const { person, args, tz, now, base } = c;
  const hold = (reason: string) => result({ outcome: 'held', reason, done: false }, tz, now, base);
  if (!SLUG.test(args.service)) return hold(T.cantDo);
  const hub = hubOf(deps);
  const t = (await hub.toolkits()).find((x) => x.slug === args.service);
  if (!t) return hold(T.notReady);
  const state = await stateOf(deps, hh, person.id, t.slug);
  if (state === 'expired') return result({ outcome: 'allowed', reason: T.signInRanOut(t.name), done: false }, tz, now, { ...base, next: 'connect_service' });
  if (state !== 'connected') return result({ outcome: 'allowed', reason: T.connectFirst(t.name), done: false }, tz, now, { ...base, next: 'connect_service' });
  const r = await hub.execute(userIdOf(hh, person.id), t.slug, 'use_app', { item: plain(String(args.item ?? '')) });
  if (!r.ok) return hold(T.appDown(t.name));
  return result({ outcome: 'allowed', reason: T.appDone(t.name, plain(String(args.item ?? 'that')) || 'that'), done: true }, tz, now, base);
}

// "held" for an app nobody allowed yet: tell an adult where to say yes (the house rules), once per ask.
export async function tellAdultsAboutApp(deps: Deps, hh: string, person: Person, service: string, now: number): Promise<void> {
  try {
    const name = (await hubOf(deps).toolkits()).find((x) => x.slug === service)?.name;
    // once an hour per person and app: a loop of asks must not flood the adults
    const hour = Math.floor(now / 3_600_000);
    if (name) await deps.store.put({ pk: Store.hk(hh), sk: `APPNOTICE#${person.id}#${service}#${hour}`, ttl: Math.floor(now / 1000) + 7200 }, { ifNotExists: true }).then(() => notifyAdults(deps.store, hh, `${person.name} wants to use ${name}. Allow it in the house rules.`, now, person.id, person.name)).catch((e: any) => { if (e?.name !== 'ConditionalCheckFailedException') throw e; });
  } catch {
    /* telling an adult never changes the answer */
  }
}
