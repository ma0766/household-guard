import { describe, expect, it } from 'vitest';
import { newHousehold, speakAs } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';
import { openApprovals } from '../../src/approvals/approvals.js';

// Audit F-2: two $15 rides at the same moment against a $20 cap. Whatever Alexa tells the person, a held answer
// that says "An adult can tap NN" must have a card waiting for that adult. Repeated, because the bug is a race.
describe('F-2: a held answer always has an approval waiting for the adult', () => {
  for (let round = 0; round < 25; round++) {
    it(`round ${round}`, async () => {
      const ctx = await newHousehold();
      await speakAs(ctx.store, ctx.hh, 'maya');
      const ride = { service: 'mock-ride', action: 'purchase', item: 'ride to the mall' };
      const [a, b] = await Promise.all([requestAction(ctx.deps, ctx.hh, { ...ride, request_id: `a${round}` }), requestAction(ctx.deps, ctx.hh, { ...ride, request_id: `b${round}` })]);
      const open = await openApprovals(ctx.deps, ctx.hh);
      for (const r of [a, b]) {
        if (r.outcome === 'held') {
          expect(r.approval_id, `a held ride must have a card for an adult: ${JSON.stringify(r)}`).toBeTruthy();
          expect(String(r.say), 'and must say so').toMatch(/An adult can tap/);
          expect(open.some((x: any) => x.id === r.approval_id), JSON.stringify(r)).toBe(true);
        }
      }
    });
  }
});
