import type { Who } from '../helpers.js';
import type { Outcome } from '../../src/core/types.js';
import type { RulesConfig } from '../../src/policy/rules.js';

// Scripted requests with fixed expected answers. Grows to 30 by S7; runs on every change.
export interface ReplayCase {
  id: string;
  slice: number;
  who: Who;
  method?: 'phone' | 'pin';
  args: { service: string; action: string; item?: string; value?: string | number; option_id?: string };
  expect: { outcome: Outcome; done?: boolean };
  rules?: Partial<RulesConfig>; // an adult's rule edit, applied before the request
}

const buy = (service: string, item: string, option_id?: string) => ({ service, action: 'purchase', item, option_id });
const home = (action: string, item?: string, value?: string | number) => ({ service: 'sim-home', action, item, value });

export const CASES: ReplayCase[] = [
  { id: 'teen-lights-off', slice: 1, who: 'maya', args: home('light', 'lights', 'off'), expect: { outcome: 'allowed', done: true } },
  { id: 'teen-unlock-denied', slice: 1, who: 'maya', args: home('unlock', 'front door'), expect: { outcome: 'denied' } },
  { id: 'teen-delete-account-denied', slice: 1, who: 'maya', args: { service: 'sim-home', action: 'delete_account' }, expect: { outcome: 'denied' } },
  { id: 'adult-unlock-allowed', slice: 1, who: 'mom', args: home('unlock', 'front door'), expect: { outcome: 'allowed' } },
  { id: 'guest-lights-allowed', slice: 1, who: 'guest', args: home('light', 'lights', 'on'), expect: { outcome: 'allowed', done: true } },
  { id: 'guest-unlock-denied', slice: 1, who: 'guest', args: home('unlock', 'front door'), expect: { outcome: 'denied' } },
  { id: 'unknown-service-held', slice: 1, who: 'maya', args: { service: 'smart-fridge', action: 'light', value: 'on' }, expect: { outcome: 'held' } },
  { id: 'child-garage-denied', slice: 1, who: 'leo', method: 'pin', args: home('garage', 'garage'), expect: { outcome: 'denied' } },
  { id: 'teen-thermostat-72-allowed', slice: 1, who: 'maya', args: home('thermostat', 'thermostat', 72), expect: { outcome: 'allowed', done: true } },
  { id: 'teen-thermostat-95-held', slice: 1, who: 'maya', args: home('thermostat', 'thermostat', 95), expect: { outcome: 'held' } },
  // S3: money
  { id: 'teen-ride-mall-15-allowed', slice: 3, who: 'maya', args: buy('mock-ride', 'ride to the mall'), expect: { outcome: 'allowed', done: false } },
  { id: 'teen-ride-airport-38-held', slice: 3, who: 'maya', args: buy('mock-ride', 'ride to the airport'), expect: { outcome: 'held' } },
  { id: 'teen-ride-airport-shared-14-allowed', slice: 3, who: 'maya', args: buy('mock-ride', 'ride to the airport', 'shared'), expect: { outcome: 'allowed' } },
  { id: 'guest-ride-denied', slice: 3, who: 'guest', args: buy('mock-ride', 'ride to the mall'), expect: { outcome: 'denied' } },
  { id: 'child-ride-held', slice: 3, who: 'leo', method: 'pin', args: buy('mock-ride', 'ride to the school'), expect: { outcome: 'held' } },
  { id: 'adult-ride-airport-38-allowed', slice: 3, who: 'mom', args: buy('mock-ride', 'ride to the airport'), expect: { outcome: 'allowed' } },
  { id: 'teen-gift-card-15-allowed-by-rules', slice: 3, who: 'maya', args: buy('mock-shop', 'gift card'), expect: { outcome: 'allowed' } },
  { id: 'teen-unknown-store-held', slice: 3, who: 'maya', args: buy('mock-food', 'pizza'), expect: { outcome: 'held' } },
  { id: 'adult-lights-by-pin-done', slice: 3, who: 'mom', method: 'pin', args: home('light', 'lights', 'off'), expect: { outcome: 'allowed', done: true } },
  { id: 'adult-unlock-by-pin-held', slice: 3, who: 'mom', method: 'pin', args: home('unlock', 'front door'), expect: { outcome: 'held' } },
  // S7: rules an adult has edited — the next decision must follow them
  { id: 'limit-raised-teen-airport-38-still-held', slice: 7, who: 'maya', rules: { weeklyCapCents: { mom: 50000, maya: 3000 }, perRequestCapCents: { mom: 20000, maya: 3000 } }, args: buy('mock-ride', 'ride to the airport'), expect: { outcome: 'held' } },
  { id: 'limit-raised-teen-airport-economy-24-allowed', slice: 7, who: 'maya', rules: { weeklyCapCents: { mom: 50000, maya: 3000 }, perRequestCapCents: { mom: 20000, maya: 3000 } }, args: buy('mock-ride', 'ride to the airport', 'economy'), expect: { outcome: 'allowed' } },
  { id: 'limit-lowered-teen-mall-15-held', slice: 7, who: 'maya', rules: { weeklyCapCents: { mom: 50000, maya: 1000 }, perRequestCapCents: { mom: 20000, maya: 1000 } }, args: buy('mock-ride', 'ride to the mall'), expect: { outcome: 'held' } },
  { id: 'adults-only-thermostat-teen-denied', slice: 7, who: 'maya', rules: { adultsOnlyActions: ['garage', 'thermostat', 'unlock'] }, args: home('thermostat', 'thermostat', 72), expect: { outcome: 'denied' } },
  { id: 'apps-without-shop-teen-gift-card-held', slice: 7, who: 'maya', rules: { allowedServices: ['mock-ride', 'sim-home'] }, args: buy('mock-shop', 'gift card'), expect: { outcome: 'held' } },
  { id: 'guest-buy-floor-off-still-denied', slice: 7, who: 'guest', rules: { floor: { childrenNoUnlock: true, guestsNoBuy: false } }, args: buy('mock-ride', 'ride to the mall'), expect: { outcome: 'denied' } },
  { id: 'child-unlock-floor-off-still-denied', slice: 7, who: 'leo', method: 'pin', rules: { floor: { childrenNoUnlock: false, guestsNoBuy: true } }, args: home('unlock', 'front door'), expect: { outcome: 'denied' } },
  { id: 'needs-approval-teen-lights-held', slice: 7, who: 'maya', rules: { needsApproval: [{ role: 'teen', action: 'light' }] }, args: home('light', 'lights', 'on'), expect: { outcome: 'held' } },
  { id: 'deny-adult-lights-denied', slice: 7, who: 'mom', rules: { deny: [{ role: 'adult', action: 'light' }] }, args: home('light', 'lights', 'on'), expect: { outcome: 'denied' } },
  { id: 'must-have-bag-teen-airport-held', slice: 7, who: 'maya', rules: { mustHaves: { bagIncluded: true } }, args: buy('mock-ride', 'ride to the airport'), expect: { outcome: 'held' } },
  // S19: private things stay private
  { id: 'child-order-history-private-denied', slice: 19, who: 'leo', method: 'pin', args: { service: 'mock-shop', action: 'order_history' }, expect: { outcome: 'denied', done: false } },
  { id: 'adult-order-history-allowed', slice: 19, who: 'mom', args: { service: 'mock-shop', action: 'order_history' }, expect: { outcome: 'allowed', done: true } },
  { id: 'guest-order-status-denied', slice: 19, who: 'guest', args: { service: 'mock-shop', action: 'order_status' }, expect: { outcome: 'denied', done: false } },
  { id: 'teen-cart-denied', slice: 19, who: 'maya', args: { service: 'mock-shop', action: 'cart' }, expect: { outcome: 'denied', done: false } },
];
