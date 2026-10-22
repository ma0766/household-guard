// Every word a person sees or hears lives here, so one test can check them all:
// no tech words, under 12 words a sentence.
import type { Role } from './core/types.js';

export const BANNED_WORDS = ['policy', 'policies', 'cedar', 'token', 'mcp', 'json', 'api', 'session', 'oauth', 'database', 'dynamodb', 'lambda', 'bedrock', 'hash', 'idempotent', 'webhook', 'endpoint'];

export const hourWord = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
export const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

export const T = {
  done: (action: string, item?: string, value?: string | number) => {
    switch (action) {
      case 'light': return `Done. The ${item || 'lights'} ${/s$/.test(item || 'lights') ? 'are' : 'is'} ${value ?? 'changed'}.`;
      case 'unlock': return `Done. The ${item || 'door'} is unlocked.`;
      case 'garage': return 'Heads up. The garage is opening.';
      case 'music': return `Done. Playing ${item || 'music'}.`;
      case 'weather': return 'It is 72 degrees and sunny.';
      case 'timer': return `Done. Timer set for ${value} ${Number(value) === 1 ? 'minute' : 'minutes'}.`;
      case 'thermostat': return `Done. It is set to ${value} degrees.`;
      default: return 'Done.';
    }
  },
  howLong: 'For how long?',
  everydayOff: 'Tell me who you are first. Say your PIN or tap your phone.',
  why: (rule: unknown) => `Because of this rule: ${String(rule).replace(/^Rule: /, '').replace(/\.$/, '')}.`,
  noWhy: 'I have not said no or yes to you yet.',
  giftMarked: 'Okay. It is marked as a gift. Only adults hear it.',
  noGiftFound: "I couldn't find that order.",
  notReady: "That isn't set up yet.",
  private: "That's private. Ask a grown-up.",
  someHidden: 'Some are private.',
  noOrders: 'No orders yet.',
  emptyCart: 'The cart is empty.',
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
  appConnected: (n: string) => `${n} is ready.`,
  appNotConnected: (n: string) => `${n} is not set up for you yet.`,
  appPending: (n: string) => `${n} is waiting for you.`,
  appNeedsAdult: 'An adult must allow it first.',
  signInRanOut: (n: string) => `Your ${n} sign-in ran out. Connect it again.`,
  connectFirst: (n: string) => `Connect ${n} first.`,
  openLink: (n: string) => `Open the link on your phone to connect ${n}.`,
  appDone: (n: string, item: string) => `Done with ${n}: ${item}.`,
  appDown: (n: string) => `${n} did not answer. Try again.`,
  homeUnsure: "I'm not sure it worked. Please check it.",
  homeUnsureNote: (what: string) => `Not sure the ${what} worked. Please check it.`,
  siteReady: (n: string) => `Your site is ready. ${n}.`,
  siteWorking: (p: number) => `Working on it. ${p} percent.`,
  siteFailed: 'I could not finish the site. Nothing was published.',
  siteFailedLeft: 'I could not finish the site. An adult was told.',
  siteBuilding: 'Okay. Building it now.',
  serviceDown: 'That service is not working. An adult was told.',
  afterRepair: 'Held: this service was just fixed. An adult must say yes once.',
  quietHours: (from: number, to: number) => `Quiet hours: no buying from ${hourWord(from)} to ${hourWord(to)}.`,
  guestNoBuy: "Guests can't buy things.",
  childNoBuy: 'An adult must say yes to buys.',
  overWeekly: (name: string, cap: number) => `Held: over ${name}'s ${money(cap)} a week.`,
  lowestWeFound: 'The lowest price we found, from the rides we checked.',
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

