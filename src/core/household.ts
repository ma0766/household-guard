import { Store } from './store.js';
import type { HouseholdMeta, Person, SessionMethod } from './types.js';
import { defaultRules, type RulesConfig } from '../policy/rules.js';
import { hashPin } from '../identity/pin.js';

export const SESSION_SECONDS = 5 * 60;

export const DEMO_PEOPLE: Person[] = [
  { id: 'mom', name: 'Mom', role: 'adult', hasPhone: true },
  { id: 'maya', name: 'Maya', role: 'teen', hasPhone: true },
  { id: 'leo', name: 'Leo', role: 'child', hasPhone: false },
  { id: 'guest', name: 'Guest', role: 'guest', hasPhone: false }, // who anyone is until they confirm
];

// demo PINs for people without a phone (documented in the README); stored only as scrypt hashes
const DEMO_PINS: Record<string, string> = { leo: '4821' };

const seeded = new Set<string>();

// Idempotent: safe on every cold start. Writes only what is missing.
export async function ensureSeeded(store: Store, hh: string): Promise<void> {
  const key = `${store.table}/${hh}`;
  if (seeded.has(key)) return;
  const pk = Store.hk(hh);
  const meta: HouseholdMeta = { id: hh, name: 'The Rivera house', timezone: 'America/New_York' };
  await store.put({ pk, sk: 'META', ...meta }, { ifNotExists: true }).catch(ignoreExists);
  for (const p of DEMO_PEOPLE) await store.put({ pk, sk: `PERSON#${p.id}`, ...p, ...(DEMO_PINS[p.id] ? { pinHash: hashPin(DEMO_PINS[p.id]) } : {}) }, { ifNotExists: true }).catch(ignoreExists);
  await store.put({ pk, sk: 'RULES#current', config: defaultRules() }, { ifNotExists: true }).catch(ignoreExists);
  // every house has a ride-service record, so the scheduled health check (S11) finds it
  await store.put({ pk, sk: 'CONN#mock-ride', surge: 1, malicious: false, failBooking: false, renamed: false, authExpired: false }, { ifNotExists: true }).catch(ignoreExists);
  seeded.add(key);
}

// The demo family: Mom, Dad, Maya (15), Leo (8, PIN), and a guest. Wipes the house first, so it is the same every time.
export const DEMO_FAMILY: Person[] = [
  { id: 'mom', name: 'Mom', role: 'adult', hasPhone: true },
  { id: 'dad', name: 'Dad', role: 'adult', hasPhone: true },
  { id: 'maya', name: 'Maya', role: 'teen', hasPhone: true, age: 15 },
  { id: 'leo', name: 'Leo', role: 'child', hasPhone: false, age: 8 },
  { id: 'guest', name: 'Guest', role: 'guest', hasPhone: false },
];

export async function resetDemoHousehold(store: Store, hh = 'demo'): Promise<{ removed: number; people: string[] }> {
  const pk = Store.hk(hh);
  const removed = await store.wipe(pk);
  seeded.delete(`${store.table}/${hh}`);
  const meta: HouseholdMeta = { id: hh, name: 'The Rivera house', timezone: 'America/New_York' };
  await store.put({ pk, sk: 'META', ...meta });
  for (const p of DEMO_FAMILY) await store.put({ pk, sk: `PERSON#${p.id}`, ...p, ...(DEMO_PINS[p.id] ? { pinHash: hashPin(DEMO_PINS[p.id]) } : {}) });
  const rules = defaultRules();
  rules.weeklyCapCents.dad = 50000;
  rules.perRequestCapCents.dad = 20000;
  await store.put({ pk, sk: 'RULES#current', config: rules });
  await store.put({ pk, sk: 'CONN#mock-ride', surge: 1, malicious: false, failBooking: false, renamed: false, authExpired: false });
  return { removed, people: DEMO_FAMILY.map((p) => p.name) };
}

function ignoreExists(e: any) {
  if (e?.name !== 'ConditionalCheckFailedException') throw e;
}

export interface HouseholdContext {
  meta: HouseholdMeta;
  people: Person[];
  rules: RulesConfig;
}

export async function loadHousehold(store: Store, hh: string): Promise<HouseholdContext> {
  const pk = Store.hk(hh);
  const [meta, people, rules] = await Promise.all([store.get(pk, 'META'), store.query(pk, 'PERSON#'), store.get(pk, 'RULES#current')]);
  if (!meta || !rules) throw new Error('household not set up');
  return { meta: meta as unknown as HouseholdMeta, people: people as unknown as Person[], rules: rules.config as RulesConfig };
}

export interface ActiveSession {
  personId: string;
  method: SessionMethod;
  confirmedAt: number;
}

export async function setSession(store: Store, hh: string, personId: string, method: Exclude<SessionMethod, 'none'>, now = Date.now()): Promise<void> {
  await store.put({ pk: Store.hk(hh), sk: 'SESSION#current', personId, method, confirmedAt: now, ttl: Math.floor(now / 1000) + SESSION_SECONDS });
}

// Identity is read ONLY from here. Expired or missing → undefined → treated as a guest.
export async function getSession(store: Store, hh: string, now = Date.now()): Promise<ActiveSession | undefined> {
  const s = await store.get(Store.hk(hh), 'SESSION#current');
  if (!s || now - s.confirmedAt > SESSION_SECONDS * 1000) return undefined;
  return { personId: s.personId, method: s.method, confirmedAt: s.confirmedAt };
}
