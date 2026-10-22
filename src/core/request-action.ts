import type { SiteBuilder } from '../sites/builder.js';
import type { HomeBackend } from '../connectors/home-assistant.js';
import type { ConnectorHub } from '../hub/hub.js';
import type { Notifier } from '../notify/notify.js';
import type { Store } from './store.js';
import { getSession, loadHousehold, ensureSeeded } from './household.js';
import { formatLocal, hourOf } from './time.js';
import { decide, type DecisionInput } from '../policy/evaluator.js';
import { explainDecision } from '../policy/explain.js';
import { KNOWN_ACTIONS, ORDER_ACTIONS } from '../policy/rules.js';
import { SIM_HOME } from '../connectors/sim-home.js';
import { handleAppAction, tellAdultsAboutApp } from './app-action.js';
import { tierOf } from './tiers.js';
import { executeAction } from './execute.js';
import { openChallenge } from '../approvals/challenge.js';
import { T } from '../text.js';
import type { ActionArgs, ActionResult, Outcome } from './types.js';
import type { JobQueue } from '../queue/queue.js';
import type { RiskChecker } from '../risk/risk.js';
import { handlePurchase } from './purchase.js';
import { auditAsk } from '../audit/emit.js';
import type { RuleParser } from '../rules/sentence.js';
import { handleOrders } from '../orders/orders.js';

export interface Deps {
  store: Store;
  now?: () => number;
  queue?: JobQueue;
  risk?: RiskChecker; // AI risk check, run by the worker; can only make a decision stricter
  sites?: SiteBuilder; // builds and publishes a one-page site (Wix, or the stand-in)
  home?: HomeBackend; // a real smart home (Home Assistant); without it the simulated home answers
  hub?: ConnectorHub; // the apps a person has connected (Composio, or the stand-in)
  notifier?: Notifier; // how adults hear about held requests (email)
  ruleParser?: RuleParser; // turns a typed rule sentence into one known setting (Bedrock, or a stand-in); never used to decide a request
  hooks?: { beforeReserve?: () => Promise<void> }; // tests only: line two requests up at the same instant
}

const GUEST_ID = 'guest';

export function result(base: { outcome: Outcome; reason: string; done: boolean }, tz: string, now: number, extra: Record<string, unknown> = {}): ActionResult {
  return { ...base, say: base.reason, at: new Date(now).toISOString(), at_local: formatLocal(now, tz), ...extra };
}

// Every path out of this function is allowed (only when the rules say so), held, or denied.
// Any throw → held. There is no code path where an error becomes "allowed".
async function decideAndAct(deps: Deps, hh: string, args: ActionArgs): Promise<ActionResult> {
  const now = (deps.now ?? Date.now)();
  let tz = 'America/New_York';
  try {
    await ensureSeeded(deps.store, hh);
    const { meta, people, rules } = await loadHousehold(deps.store, hh);
    tz = meta.timezone;
    // identity comes ONLY from a confirmed session — never from anything the caller typed
    const session = await getSession(deps.store, hh, now);
    const found = session && people.find((p) => p.id === session.personId);
    const person = found || people.find((p) => p.id === GUEST_ID) || { id: GUEST_ID, name: 'Guest', role: 'guest' as const, hasPhone: false };
    const isGuest = person.id === GUEST_ID;
    const method = isGuest || !session ? 'none' : session.method;

    if ((ORDER_ACTIONS as readonly string[]).includes(args.action)) return await handleOrders(deps, hh, { person, method, rules, tz, now, args });
    if (args.action === 'purchase') return await handlePurchase(deps, hh, { person, method, rules, tz, now, args });

    const value = Number(args.value);
    const input: DecisionInput = {
      person: { id: person.id, role: person.role },
      action: args.action,
      service: args.service,
      serviceKnown: rules.allowedServices.includes(args.service),
      amountCents: 0,
      weekSpentCents: 0,
      value: Number.isFinite(value) ? Math.trunc(value) : 0,
      session: method,
      localHour: hourOf(now, tz),
    };
    const d = decide(rules, input);
    const base = { person: person.id, person_name: person.name, service: args.service, action: args.action, rule: explainDecision(d, rules, person.name) };

    if (d.answer === 'allow') {
      if (args.action === 'build_site') {
        // a long job: nothing is built until THIS person taps her own phone; then it is queued and the work happens in the worker
        const { challenge, locked } = await openChallenge(deps, hh, person, 'action', args, { site: { item: args.item } });
        if (locked || !challenge) return result({ outcome: 'held', reason: T.locked, done: false }, tz, now, base);
        return result({ outcome: 'allowed', reason: T.confirmOnPhone(challenge.number), done: false }, tz, now, { ...base, next: 'confirm_on_phone', number: challenge.number, job_id: challenge.id, tier: 'high' });
      }
      if (args.action === 'use_app') return await handleAppAction(deps, hh, { person, args, tz, now, base });
      if (args.service === SIM_HOME) {
        const tier = tierOf(args);
        // low risk: just do it. Medium by PIN (no phone): do it. Otherwise: a number to match on the person's OWN phone.
        if (tier === 'low' || (tier === 'medium' && method === 'pin')) {
          const ex = await executeAction(deps, hh, person.id, args);
          return result({ outcome: 'allowed', reason: ex.reason, done: ex.done }, tz, now, base);
        }
        const { challenge, locked } = await openChallenge(deps, hh, person, 'action', args);
        if (locked || !challenge) return result({ outcome: 'held', reason: T.locked, done: false }, tz, now, base);
        return result({ outcome: 'allowed', reason: T.confirmOnPhone(challenge.number), done: false }, tz, now, { ...base, next: 'confirm_on_phone', number: challenge.number, job_id: challenge.id, tier });
      }
      // allowed by the rules, but no connector for this service yet
      return result({ outcome: 'held', reason: T.notReady, done: false }, tz, now, base);
    }
    if (d.answer === 'hold') {
      if (args.action === 'use_app') await tellAdultsAboutApp(deps, hh, person, args.service, now);
      const reason = !input.serviceKnown ? T.newService : (args.action === 'unlock' || args.action === 'garage') && method === 'pin' ? T.confirmPhone : args.action === 'thermostat' ? T.bigChange : T.needsAdult;
      return result({ outcome: 'held', reason, done: false }, tz, now, base);
    }
    const known = (KNOWN_ACTIONS as readonly string[]).includes(args.action);
    const reason = !known ? T.cantDo : d.determining.some((x) => x === 'floor_guests_no_buy') ? T.guestNoBuy : isGuest ? T.whoAreYou : d.determining.some((x) => x.startsWith('adults_only_') || x === 'floor_children_no_unlock') ? T.onlyAdults : T.cantDo;
    return result({ outcome: 'denied', reason, done: false }, tz, now, base);
  } catch {
    return result({ outcome: 'held', reason: T.oops, done: false }, tz, now);
  }
}

// The public entry: decide and act, then write what happened in the log. The log never changes the answer.
export async function requestAction(deps: Deps, hh: string, args: ActionArgs): Promise<ActionResult> {
  const r = await decideAndAct(deps, hh, args);
  await auditAsk(deps, hh, args, r);
  return r;
}
