// Every word a person sees or hears lives here, so one test can check them all:
// no tech words, under 12 words a sentence.
import type { Role } from './core/types.js';

export const BANNED_WORDS = ['policy', 'policies', 'cedar', 'token', 'mcp', 'json', 'api', 'session', 'oauth', 'database', 'dynamodb', 'lambda', 'bedrock', 'hash', 'idempotent', 'webhook', 'endpoint'];

export const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

export const T = {
  done: (action: string, item?: string, value?: string | number) => {
    switch (action) {
      case 'light': return `Done. The ${item || 'lights'} ${/s$/.test(item || 'lights') ? 'are' : 'is'} ${value ?? 'changed'}.`;
      case 'unlock': return `Done. The ${item || 'door'} is unlocked.`;
      case 'garage': return 'Done. The garage is open.';
      case 'thermostat': return `Done. It is set to ${value} degrees.`;
      default: return 'Done.';
    }
  },
  notReady: "That isn't set up yet.",
  onlyAdults: 'Only adults can do that.',
  whoAreYou: 'Tell me who you are first.',
  cantDo: "I can't do that.",
  newService: "That's new here. An adult must say yes.",
  bigChange: "That's a big change. An adult must say yes.",
  confirmPhone: 'Confirm on your phone first.',
  needsAdult: 'An adult must say yes first.',
  oops: 'Something went wrong. Ask an adult.',
  confirmOnPhone: (n: number) => `Confirm on your phone: ${n}`,
  locked: 'Too many tries. Wait 10 minutes.',
  guestNoBuy: "Guests can't buy things.",
  childNoBuy: 'An adult must say yes to buys.',
  overWeekly: (name: string, cap: number) => `Held: over ${name}'s ${money(cap)} a week.`,
  overOneBuy: (name: string, cap: number) => `Held: over ${name}'s ${money(cap)} for one buy.`,
  rideBooked: (total: number) => `Your ride is booked. ${money(total)} in all.`,
  bought: (total: number) => `Done. You spent ${money(total)}.`,
  booking: 'Okay. Booking it now.',
  priceChanged: 'The price changed. Ask again.',
  cantFind: "I couldn't find that.",
  bookFailed: "I couldn't book it. You were not charged.",
  busy: 'Still working on that one.',
  altOffer: (what: string, total: number) => `A ${what} for ${money(total)} fits.`,
  riskHeld: 'Held: this needs a closer look.',
  wantThat: 'Want that one?',
  adultCanTap: (n: number) => `An adult can tap ${n} to say yes.`,
};

export const roleName: Record<Role, string> = { adult: 'adult', teen: 'teen', child: 'child', guest: 'guest' };

