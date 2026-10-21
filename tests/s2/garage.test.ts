import { describe, expect, it } from 'vitest';
import { newHousehold, speakAs } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';

const garage = { service: 'sim-home', action: 'garage', item: 'garage' };

// S2 tier table: "open the garage" is MEDIUM — your own phone tap (a PIN is not enough, nobody without a tap gets it).
describe('S2 medium risk: the garage', () => {
  it('an adult who confirmed by phone: yes, but the tap on her own phone comes first', async () => {
    const { store, hh, deps } = await newHousehold();
    await speakAs(store, hh, 'mom', 'phone');
    const r = await requestAction(deps, hh, garage);
    expect(r).toMatchObject({ outcome: 'allowed', done: false, next: 'confirm_on_phone' });
  });
  it('an adult who only gave a PIN: held, not done', async () => {
    const { store, hh, deps } = await newHousehold();
    await speakAs(store, hh, 'mom', 'pin');
    const r = await requestAction(deps, hh, garage);
    expect(r.outcome).toBe('held');
    expect(r.done).toBe(false);
  });
  it('a teen and a guest are denied', async () => {
    for (const who of ['maya', 'guest'] as const) {
      const { store, hh, deps } = await newHousehold();
      await speakAs(store, hh, who);
      expect((await requestAction(deps, hh, garage)).outcome).toBe('denied');
    }
  });
});
