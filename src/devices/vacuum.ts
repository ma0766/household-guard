import { Store } from '../core/store.js';
import { deviceKey } from './vault.js';

// STAND-IN for the Home Assistant demo vacuum. It keeps its own status in the table, as a real device reports its own:
// idle, cleaning, stuck, error. The house never decides health: it only reads what the device says.
export const VACUUM = 'robot-vacuum';
export type VacuumStatus = 'idle' | 'cleaning' | 'stuck' | 'error';
const sk = 'DEVICE#robot-vacuum';

export async function vacuumStatus(store: Store, hh: string): Promise<VacuumStatus> {
  const r = await store.get(Store.hk(hh), sk);
  return (r?.status as VacuumStatus) ?? 'idle';
}
export async function setVacuumStatus(store: Store, hh: string, status: VacuumStatus): Promise<void> {
  await store.put({ pk: Store.hk(hh), sk, status, at: Date.now() });
}

// Start or stop. It needs the key the adult typed on their phone: no key, no call (the caller holds).
export async function runVacuum(store: Store, hh: string, what: 'start' | 'stop'): Promise<{ ok: boolean; status: VacuumStatus }> {
  const key = await deviceKey(store, hh, VACUUM);
  if (!key) throw new Error('the vacuum has no key');
  const was = await vacuumStatus(store, hh);
  if (was === 'stuck' || was === 'error') return { ok: false, status: was }; // the device says it cannot
  const status: VacuumStatus = what === 'start' ? 'cleaning' : 'idle';
  await setVacuumStatus(store, hh, status);
  return { ok: true, status };
}
