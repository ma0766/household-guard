import { Store } from '../core/store.js';

// Simulated smart home: lights, front door, thermostat, garage. State lives in the table so every Lambda agrees.
export const SIM_HOME = 'sim-home';

export async function execSimHome(store: Store, hh: string, action: string, item: string | undefined, value: string | number | undefined) {
  const device = action === 'light' ? 'lights' : action === 'unlock' ? 'front door' : action === 'garage' ? 'garage' : action === 'thermostat' ? 'thermostat' : action;
  const state = action === 'unlock' ? 'unlocked' : action === 'garage' ? 'open' : action === 'weather' ? 'asked' : String(value ?? 'on');
  await store.put({ pk: Store.hk(hh), sk: `DEVICE#${device}`, device, state, item: item ?? null, changedAt: Date.now() });
  return { device, state };
}

export async function readHome(store: Store, hh: string) {
  return (await store.query(Store.hk(hh), 'DEVICE#')).map((d) => ({ device: d.device as string, state: d.state as string }));
}
