import type { Deps } from '../core/request-action.js';
import { Store } from '../core/store.js';
import { loadHousehold } from '../core/household.js';
import { notifyAdults } from '../identity/guard.js';
import { DEVICES } from './catalog.js';
import { vacuumStatus, VACUUM } from './vacuum.js';

// Health comes from the device's own status. Stuck or error: one plain sentence to the adults, once for each time it happens.
export async function checkDevices(deps: Deps, hh: string): Promise<{ service: string; status: string; alerted: boolean }[]> {
  const now = (deps.now ?? Date.now)();
  const { rules } = await loadHousehold(deps.store, hh, now);
  const out: { service: string; status: string; alerted: boolean }[] = [];
  for (const d of DEVICES) {
    if (!rules.serviceKinds?.[d.service]) continue; // not connected
    const status = d.service === VACUUM ? await vacuumStatus(deps.store, hh) : 'idle';
    let alerted = false;
    const key = `HEALTHALERT#${d.service}`;
    if (status === 'stuck' || status === 'error') {
      const seen = await deps.store.get(Store.hk(hh), key);
      if (seen?.status !== status) {
        await deps.store.put({ pk: Store.hk(hh), sk: key, status, at: now });
        await notifyAdults(deps.store, hh, `${d.name[0].toUpperCase()}${d.name.slice(1)} is ${status === 'stuck' ? 'stuck' : 'not working'}. Please check it.`, now, 'device', d.name);
        alerted = true;
      }
    } else {
      await deps.store.delete(Store.hk(hh), key).catch(() => undefined); // it is fine again: the next trouble alerts again
    }
    out.push({ service: d.service, status, alerted });
  }
  return out;
}
