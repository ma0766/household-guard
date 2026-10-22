import type { Deps } from '../core/request-action.js';
import { Store } from '../core/store.js';
import { loadHousehold } from '../core/household.js';
import { applyNow } from '../rules/change.js';
import { T } from '../text.js';

// A suggestion is asked once and waits for an adult. The camera stays off unless an adult taps Yes on their own phone.
export async function openSuggestions(deps: Deps, hh: string): Promise<{ id: string; text: string }[]> {
  const rows = await deps.store.query(Store.hk(hh), 'SUGGEST#');
  return rows.filter((r) => r.status === 'open').map((r) => ({ id: String(r.id), text: String(r.text) }));
}

export async function answerSuggestion(deps: Deps, hh: string, personId: string, id: string, answer: 'yes' | 'no'): Promise<{ status: 'done' | 'no' | 'refused'; say: string }> {
  try {
    const { people } = await loadHousehold(deps.store, hh, (deps.now ?? Date.now)());
    const me = people.find((p) => p.id === personId);
    if (!me || me.role !== 'adult' || !me.hasPhone || id !== 'camera') return { status: 'refused', say: T.onlyAdults };
    // closed first, once: a double tap cannot answer twice
    try {
      await deps.store.update({ Key: { pk: Store.hk(hh), sk: 'SUGGEST#camera' }, UpdateExpression: 'SET #s = :a', ConditionExpression: '#s = :o', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':a': answer === 'yes' ? 'yes' : 'no', ':o': 'open' } });
    } catch {
      return { status: 'refused', say: 'It is done.' };
    }
    if (answer === 'no') return { status: 'no', say: 'Okay. The camera stays off.' };
    const r = await applyNow(deps, hh, personId, { template: 'camera', enabled: true });
    return r.done ? { status: 'done', say: r.reason } : { status: 'refused', say: r.reason };
  } catch {
    return { status: 'refused', say: T.oops };
  }
}
