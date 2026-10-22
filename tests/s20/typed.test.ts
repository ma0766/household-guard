import { describe, expect, it } from 'vitest';
import { StandInRuleParser, toChange } from '../../src/rules/sentence.js';

const PEOPLE = [{ id: 'mom', name: 'Mom', role: 'adult' }, { id: 'maya', name: 'Maya', role: 'teen' }, { id: 'leo', name: 'Leo', role: 'child' }, { id: 'guest', name: 'Guest', role: 'guest' }];
const read = (s: string) => new StandInRuleParser().parse(s, PEOPLE);

describe('typed sentences for the new settings', () => {
  it('the guest switch', async () => {
    expect(await read('Turn off everyday things for guests')).toEqual({ change: { template: 'guest_switch', enabled: false } });
    expect(await read('Everyday things are open to anyone at home')).toEqual({ change: { template: 'guest_switch', enabled: true } });
  });
  it('the no-tap list', async () => {
    expect(await read('Maya can buy up to 5 dollars without a tap')).toEqual({ change: { template: 'no_tap_buys', person: 'maya', cents: 500 } });
    expect(await read('Maya taps for every buy')).toEqual({ change: { template: 'no_tap_buys', person: 'maya', cents: null } });
  });
  it('unclear ones get a question, never a guess', async () => {
    expect('question' in (await read('Maya can buy without a tap'))).toBe(true);
    expect('question' in (await read('Everyday things and Maya can spend 30 dollars a week'))).toBe(true);
    expect('question' in (await read('Leo can buy up to 500 dollars without a tap'))).toBe(true); // a child is not on the list; 500 is too big
  });
  it('whatever a model sends is checked: out of range, a child, nonsense', () => {
    expect('question' in toChange({ template: 'no_tap_buys', person: 'leo', dollars: 5 }, PEOPLE)).toBe(true);
    expect('question' in toChange({ template: 'no_tap_buys', person: 'maya', dollars: 500 }, PEOPLE)).toBe(true);
    expect('question' in toChange({ template: 'guest_switch', enabled: 'yes' }, PEOPLE)).toBe(true);
    expect('question' in toChange({ template: 'add_guest', name: 'Sam' }, PEOPLE)).toBe(true); // guests have PINs and dates: cards only
  });
});
