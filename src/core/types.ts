export type Role = 'adult' | 'teen' | 'child' | 'guest';
export type SessionMethod = 'phone' | 'pin' | 'none';

export interface Person {
  id: string;
  name: string;
  role: Role;
  hasPhone: boolean;
  pinHash?: string; // scrypt, S2
}

export interface HouseholdMeta {
  id: string;
  name: string;
  timezone: string; // IANA — every timestamp and "this week" is evaluated here
}

export type Outcome = 'allowed' | 'held' | 'denied';

export interface ActionArgs {
  service: string;
  action: string;
  item?: string;
  value?: string | number;
  request_id?: string;
  option_id?: string;
  replaces?: string;
}

export interface ActionResult {
  outcome: Outcome;
  reason: string;
  done: boolean;
  say: string; // what Alexa says out loud
  at: string; // ISO instant
  at_local: string; // household local time
  person?: string;
  [k: string]: unknown;
}
