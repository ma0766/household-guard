import type { Who } from '../helpers.js';
import type { Outcome } from '../../src/core/types.js';

// Scripted requests with fixed expected answers. Grows to 30 by S7; runs on every change.
export interface ReplayCase {
  id: string;
  slice: number;
  who: Who;
  method?: 'phone' | 'pin';
  args: { service: string; action: string; item?: string; value?: string | number; option_id?: string };
  expect: { outcome: Outcome; done?: boolean };
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
];
