// Six kinds of action. Every action is one kind, and every service (a tool, a device, an app) says which kinds it offers when it is
// connected. A service that has not said is held for an adult. Rules can aim at a whole kind ("teens: no money things").
export const KINDS = ['info', 'control', 'money', 'access', 'act', 'power'] as const;
export type Kind = (typeof KINDS)[number];

// plain words for people
export const KIND_WORDS: Record<Kind, string> = {
  info: 'looking things up',
  control: 'controlling things',
  money: 'spending money',
  access: 'doors and cameras',
  act: 'acting in your name',
  power: 'adding new powers',
};

// What each action is. Defaults: info and control = anyone, no tap. Money = a phone tap, inside limits. Access, acting in your name,
// and adding new powers = an adult, with a tap. (The garage stays "control" on purpose: adults and teens, no tap, by the house's own rule.)
const KIND_OF: Record<string, Kind> = {
  weather: 'info', mark_gift: 'info', order_history: 'info', order_status: 'info', cart: 'info', why: 'info', order_gift: 'info', start_project: 'info',
  light: 'control', thermostat: 'control', music: 'control', timer: 'control', garage: 'control', use_app: 'control', vacuum: 'control',
  purchase: 'money',
  unlock: 'access', camera: 'access',
  build_site: 'act', publish_project: 'act',
  connect_device: 'power', enable_camera: 'power', set_rule: 'power',
};
export const kindOf = (action: string): Kind | undefined => KIND_OF[action];

// What the services that ship with the house say they offer. A device added later declares its own (see src/devices/catalog.ts).
export const DEFAULT_SERVICE_KINDS: Record<string, Kind[]> = {
  'sim-home': ['info', 'control', 'access'],
  'mock-ride': ['money'],
  'mock-shop': ['info', 'money'],
  'mock-pay': ['money'],
  wix: ['act'],
  spotify: ['control'],
};

export interface HasKinds { allowedServices: string[]; serviceKinds?: Record<string, Kind[]> }

export function declaredKinds(rules: HasKinds, service: string): Kind[] | undefined {
  return rules.serviceKinds?.[service] ?? DEFAULT_SERVICE_KINDS[service];
}

// "Known" for the rules: the house allowed the service AND the service declared this kind of action. Anything else is held for an adult.
export function serviceKnownFor(rules: HasKinds, service: string, action: string): boolean {
  if (!rules.allowedServices.includes(service)) return false;
  const k = kindOf(action);
  if (!k) return true; // an action nobody knows is denied by the rules anyway; its service is judged only by the allowed list
  return !!declaredKinds(rules, service)?.includes(k);
}
