import { describe, expect, it } from 'vitest';
import { newHousehold, speakAs } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';
import { Store } from '../../src/core/store.js';
import { defaultRules } from '../../src/policy/rules.js';

const garage = { service: 'sim-home', action: 'garage', item: 'garage' };

// Levelup tier table: the garage is LOW risk for adults and teens (a spoken heads-up, no tap). Children and guests never.
// (Before levelup it needed the adult's own phone tap, and teens were denied. The user changed the table: see docs/PROGRESS.md.)
describe('the garage: adults and teens at once, children and guests never', () => {
  it('an adult who confirmed by phone: done at once, with a spoken heads-up and no tap', async () => {
    const { store, hh, deps } = await newHousehold();
    await speakAs(store, hh, 'mom', 'phone');
    const r = await requestAction(deps, hh, garage);
    expect(r).toMatchObject({ outcome: 'allowed', done: true });
    expect(r.say).toMatch(/^Heads up/);
    expect(r.next).toBeUndefined();
  });
  it('an adult who only gave a PIN: done at once too', async () => {
    const { store, hh, deps } = await newHousehold();
    await speakAs(store, hh, 'mom', 'pin');
    expect(await requestAction(deps, hh, garage)).toMatchObject({ outcome: 'allowed', done: true });
  });
  it('a teen who is confirmed: done at once', async () => {
    const { store, hh, deps } = await newHousehold();
    await speakAs(store, hh, 'maya');
    expect(await requestAction(deps, hh, garage)).toMatchObject({ outcome: 'allowed', done: true });
  });
  it('a child and a guest are denied', async () => {
    for (const who of ['leo', 'guest'] as const) {
      const { store, hh, deps } = await newHousehold();
      await speakAs(store, hh, who, 'pin');
      expect((await requestAction(deps, hh, garage)).outcome).toBe('denied');
    }
  });
  it('when an adult makes the garage adults-only, the teen is denied again', async () => {
    const { store, hh, deps } = await newHousehold();
    await store.put({ pk: Store.hk(hh), sk: 'RULES#current', config: { ...defaultRules(), adultsOnlyActions: ['unlock', 'garage'] } });
    await speakAs(store, hh, 'maya');
    expect((await requestAction(deps, hh, garage)).outcome).toBe('denied');
  });
});
