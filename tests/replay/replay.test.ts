import { describe, expect, it, afterAll } from 'vitest';
import { CASES } from './cases.js';
import { newHousehold, speakAs } from '../helpers.js';
import { Store } from '../../src/core/store.js';
import { defaultRules } from '../../src/policy/rules.js';
import { requestAction } from '../../src/core/request-action.js';

let passed = 0;
describe('replay: scripted requests, fixed answers', () => {
  for (const c of CASES) {
    it(`${c.id}`, async () => {
      const { hh, store, deps } = await newHousehold();
      if (c.rules) await store.put({ pk: Store.hk(hh), sk: 'RULES#current', config: { ...defaultRules(), ...c.rules } });
      await speakAs(store, hh, c.who, c.method ?? 'phone');
      const r = await requestAction(deps, hh, c.args);
      expect(r.outcome).toBe(c.expect.outcome);
      if (c.expect.done !== undefined) expect(r.done).toBe(c.expect.done);
      passed++;
    });
  }
  afterAll(() => console.log(`REPLAY: ${passed} of ${CASES.length} cases passing`));
});
