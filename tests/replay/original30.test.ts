import { describe, expect, it } from 'vitest';
import { CASES } from './cases.js';
import { newHousehold, speakAs } from '../helpers.js';
import { Store } from '../../src/core/store.js';
import { defaultRules } from '../../src/policy/rules.js';
import { requestAction } from '../../src/core/request-action.js';

// The ORIGINAL 30 replay cases (slices 1 to 7), run on their own so "results unchanged" is checked as the 30, not as part of the 34.
const ORIGINAL = CASES.filter((c) => c.slice <= 7);
describe('replay: the original 30 cases, on their own', () => {
  it('there are exactly 30', () => expect(ORIGINAL).toHaveLength(30));
  for (const c of ORIGINAL) {
    it(`${c.id}`, async () => {
      const { hh, store, deps } = await newHousehold();
      if (c.rules) await store.put({ pk: Store.hk(hh), sk: 'RULES#current', config: { ...defaultRules(), ...c.rules } });
      await speakAs(store, hh, c.who, c.method ?? 'phone');
      const r = await requestAction(deps, hh, c.args);
      expect(r.outcome).toBe(c.expect.outcome);
      if (c.expect.done !== undefined) expect(r.done).toBe(c.expect.done);
    });
  }
});
