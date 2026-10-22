import type { SiteBuilder } from '../sites/builder.js';
import type { HomeBackend } from '../connectors/home-assistant.js';
import type { ConnectorHub } from '../hub/hub.js';
import type { Notifier } from '../notify/notify.js';
import { Store } from './store.js';
import { getSession, loadHousehold, ensureSeeded } from './household.js';
import { formatLocal, hourOf } from './time.js';
import { decide, type DecisionInput, type PolicyDecision } from '../policy/evaluator.js';
import { explainDecision } from '../policy/explain.js';
import { KNOWN_ACTIONS, ORDER_ACTIONS, type RulesConfig } from '../policy/rules.js';
import { SIM_HOME } from '../connectors/sim-home.js';
import { handleAppAction, tellAdultsAboutApp } from './app-action.js';
import { serviceKnownFor } from '../policy/kinds.js';
import { kindOf } from '../policy/kinds.js';
import { deviceByWords } from '../devices/catalog.js';
import { runVacuum, VACUUM } from '../devices/vacuum.js';
import { deviceKey } from '../devices/vault.js';
import { checkDevices } from '../devices/health.js';
import { proposeRule } from '../rules/change.js';
import { tierOf } from './tiers.js';
import { executeAction } from './execute.js';
import { openChallenge } from '../approvals/challenge.js';
import { T } from '../text.js';
import type { ActionArgs, ActionResult, Outcome, Person } from './types.js';
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
  trace?: { input?: DecisionInput }; // set per request: the first decision's inputs, kept in the log so a new rule can be tried on the past week
  hooks?: { beforeReserve?: () => Promise<void> }; // tests only: line two requests up at the same instant
}

const GUEST_ID = 'guest';

// The same decision as decide(), but the first one a request makes is remembered for the log (try-it-first replays it later).
export function decideTraced(deps: Deps, rules: RulesConfig, input: DecisionInput): PolicyDecision {
  if (deps.trace && !deps.trace.input) deps.trace.input = input;
  return decide(rules, input);
}

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
    const { meta, people, rules } = await loadHousehold(deps.store, hh, now);
    tz = meta.timezone;
    // identity comes ONLY from a confirmed session — never from anything the caller typed
    const session = await getSession(deps.store, hh, now);
    const found = session && people.find((p) => p.id === session.personId);
    const person = found || people.find((p) => p.id === GUEST_ID) || { id: GUEST_ID, name: 'Guest', role: 'guest' as const, hasPhone: false };
    const isGuest = person.id === GUEST_ID;
    const method = isGuest || !session ? 'none' : session.method;

    if (args.action === 'why') return await handleWhy(deps, hh, person.id, tz, now);
    if ((ORDER_ACTIONS as readonly string[]).includes(args.action)) return await handleOrders(deps, hh, { person, method, rules, tz, now, args });
    if (args.action === 'purchase') return await handlePurchase(deps, hh, { person, method, rules, tz, now, args });

    const value = Number(args.value);
    const input: DecisionInput = {
      person: { id: person.id, role: person.role },
      action: args.action,
      service: args.service,
      serviceKnown: serviceKnownFor(rules, args.service, args.action),
      amountCents: 0,
      weekSpentCents: 0,
      value: Number.isFinite(value) ? Math.trunc(value) : 0,
      session: method,
      localHour: hourOf(now, tz),
    };
    const d = decideTraced(deps, rules, input);
    const base = { person: person.id, person_name: person.name, service: args.service, action: args.action, rule: explainDecision(d, rules, person.name) };

    if (d.answer === 'allow') {
      if (args.action === 'timer' && !(Number.isInteger(value) && value >= 1 && value <= 1440)) return result({ outcome: 'denied', reason: T.howLong, done: false }, tz, now, base);
      if (args.action === 'connect_device') return await handleConnectDevice(deps, hh, { person, rules, tz, now, args, base });
      if (args.service === VACUUM && args.action === 'vacuum') return await handleVacuum(deps, hh, { tz, now, args, base });
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
    const known = !!kindOf(args.action) || (KNOWN_ACTIONS as readonly string[]).includes(args.action);
    const reason = !known ? T.cantDo : d.determining.some((x) => x === 'everyday_needs_a_person') ? T.everydayOff : args.action === 'camera' && person.role === 'adult' && !rules.cameraOn ? T.cameraOff : args.action === 'connect_device' && !isGuest ? T.onlyAdults : d.determining.some((x) => x === 'floor_guests_no_buy') ? T.guestNoBuy : isGuest ? T.whoAreYou : d.determining.some((x) => x.startsWith('adults_only_') || x === 'floor_children_no_unlock') ? T.onlyAdults : T.cantDo;
    return result({ outcome: 'denied', reason, done: false }, tz, now, base);
  } catch {
    return result({ outcome: 'held', reason: T.oops, done: false }, tz, now);
  }
}

// The public entry: decide and act, then write what happened in the log. The log never changes the answer.
export async function requestAction(deps: Deps, hh: string, args: ActionArgs): Promise<ActionResult> {
  const d = { ...deps, trace: {} as NonNullable<Deps['trace']> };
  const r = await decideAndAct(d, hh, args);
  if (args.action === 'why') return r; // asking why is not itself a decision to remember or log
  await auditAsk(deps, hh, args, r, d.trace.input);
  await rememberDecision(deps, hh, r);
  return r;
}

// "Why?": one sentence naming the rule that decided this person's last answer.
async function rememberDecision(deps: Deps, hh: string, r: ActionResult): Promise<void> {
  try {
    if (typeof r.rule !== 'string' || !r.rule) return;
    const now = (deps.now ?? Date.now)();
    await deps.store.put({ pk: Store.hk(hh), sk: `LASTASK#${r.person ?? GUEST_ID}`, rule: r.rule, at: now, ttl: Math.floor(now / 1000) + 3600 });
  } catch {
    /* remembering never changes an answer */
  }
}

async function handleWhy(deps: Deps, hh: string, personId: string, tz: string, now: number): Promise<ActionResult> {
  const last = await deps.store.get(Store.hk(hh), `LASTASK#${personId}`);
  const rule = typeof last?.rule === 'string' ? last.rule : '';
  return result({ outcome: 'allowed', reason: rule ? T.why(rule) : T.noWhy, done: true }, tz, now, { person: personId, rule });
}

// "Connect my new robot vacuum": the reply is quick (no key, no network). It starts a card on the adult's own phone, where the key is typed.
// Only an adult with a phone confirmation gets here (the rules said so); the device's kinds come from its own declaration.
async function handleConnectDevice(deps: Deps, hh: string, c: { person: Person; rules: RulesConfig; tz: string; now: number; args: ActionArgs; base: Record<string, unknown> }): Promise<ActionResult> {
  const { person, rules, tz, now, args, base } = c;
  const dev = deviceByWords(String(args.item ?? ''));
  if (!dev) return result({ outcome: 'denied', reason: T.noDevice, done: false }, tz, now, base);
  if (rules.serviceKinds?.[dev.service]) return result({ outcome: 'denied', reason: T.deviceAlready, done: false }, tz, now, base);
  const r = await proposeRule(deps, hh, { change: { template: 'declare_service', service: dev.service } }, person.id, { needsKey: true });
  if (r.status !== 'waiting') return result({ outcome: 'held', reason: r.say, done: false }, tz, now, base);
  return result({ outcome: 'allowed', reason: `${T.addOnPhone} ${r.say}`, done: false }, tz, now, { ...base, next: 'finish_on_phone', number: r.number, job_id: r.challenge_id, tier: 'high' });
}

async function handleVacuum(deps: Deps, hh: string, c: { tz: string; now: number; args: ActionArgs; base: Record<string, unknown> }): Promise<ActionResult> {
  const { tz, now, args, base } = c;
  if (!(await deviceKey(deps.store, hh, VACUUM))) return result({ outcome: 'held', reason: T.notReady, done: false }, tz, now, base);
  const what = String(args.value ?? 'start') === 'stop' ? 'stop' : 'start';
  const r = await runVacuum(deps.store, hh, what); // a failure throws, and the caller holds
  await checkDevices(deps, hh); // the device's own status: stuck or error tells the adults
  if (!r.ok) return result({ outcome: 'held', reason: r.status === 'stuck' ? T.vacuumStuck : T.vacuumError, done: false }, tz, now, base);
  return result({ outcome: 'allowed', reason: what === 'start' ? T.vacuumStarted : T.vacuumStopped, done: true }, tz, now, base);
}
