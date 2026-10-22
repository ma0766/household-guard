import { describe, expect, it } from 'vitest';
import { previewChange } from '../../src/rules/preview.js';
import { defaultRules, type RulesConfig } from '../../src/policy/rules.js';
import { DEMO_PEOPLE } from '../../src/core/household.js';
import { BANNED_WORDS } from '../../src/text.js';

// The preview is read before saving: what would this change let people do (or stop them doing)?
const base = defaultRules();
const edit = (f: (c: RulesConfig) => void): RulesConfig => { const c: RulesConfig = JSON.parse(JSON.stringify(base)); f(c); return c; };
const prev = (after: RulesConfig, before = base) => previewChange(before, after, DEMO_PEOPLE);

describe('S10 plain-language preview of a rule change', () => {
  it('a higher limit says how much more', () => {
    expect(prev(edit((c) => { c.weeklyCapCents.maya = 3000; c.perRequestCapCents.maya = 3000; }))).toEqual(['This lets Maya spend $10 more a week.']);
  });
  it('a lower limit says how much less', () => {
    expect(prev(edit((c) => { c.weeklyCapCents.maya = 1500; c.perRequestCapCents.maya = 1500; }))).toEqual(['Maya can spend $5 less a week.']);
  });
  it('letting a child unlock the door asks "are you sure?"', () => {
    const open = edit((c) => { c.adultsOnlyActions = ['garage']; c.floor.childrenNoUnlock = false; });
    expect(prev(open)).toContain('This change lets a child unlock the front door. Are you sure?');
  });
  it('turning off the child-unlock rule alone changes nothing, because adults-only still blocks it', () => {
    expect(prev(edit((c) => { c.floor.childrenNoUnlock = false; }))).toEqual(['This changes nothing for now.']);
  });
  it('letting a teen use the garage says so', () => {
    // levelup: the garage is open to teens by default now, so this starts from a house that made it adults-only
    const adultsOnlyGarage = edit((c) => { c.adultsOnlyActions = ['unlock', 'garage']; });
    expect(prev(edit((c) => { c.adultsOnlyActions = ['unlock']; }), adultsOnlyGarage)).toContain('This change lets a teen open the garage. Are you sure?');
  });
  it('letting a guest buy says so', () => {
    expect(prev(edit((c) => { c.floor.guestsNoBuy = false; c.weeklyCapCents.guest = 2000; c.perRequestCapCents.guest = 2000; }))).toEqual(['This change lets a guest buy things. Are you sure?']);
  });
  it('quiet hours on is stricter; off is looser', () => {
    const on = edit((c) => { c.quietHours = { fromHour: 21, toHour: 6 }; });
    expect(prev(on)).toEqual(['Kids cannot buy from 9 PM to 6 AM.']);
    expect(prev(base, on)).toEqual(['This lets kids buy at any hour.']);
  });
  it('allowed apps: adding a store lets a teen buy there without asking; removing the ride app puts rides on hold', () => {
    expect(prev(edit((c) => { c.allowedServices = [...c.allowedServices, 'mock-food']; c.serviceKinds = { 'mock-food': ['money'] }; })))  // kinds: a service that has not declared what it offers is held, so this store declares money
      .toContain('This change lets a teen buy things. Are you sure?');
    expect(prev(edit((c) => { c.allowedServices = c.allowedServices.filter((x) => x !== 'mock-ride'); }))).toContain('This is stricter for a teen: buy things.');
  });
  it('a first weekly limit for someone with none says they can now buy up to it without asking', () => {
    expect(prev(edit((c) => { c.weeklyCapCents.leo = 1000; c.perRequestCapCents.leo = 1000; }))).toContain('This lets Leo buy up to $10 a week without asking.');
  });
  it('best-value must-haves are said out loud', () => {
    expect(prev(edit((c) => { c.mustHaves = { bagIncluded: true }; }))).toContain('Cheaper rides must now include a bag.');
    expect(prev(edit((c) => { c.mustHaves = { arriveByHour: 18 }; }))).toContain('Cheaper rides must now arrive by 6 PM.');
    expect(prev(edit((c) => { c.mustHaves = { bagIncluded: true } }), edit((c) => { c.mustHaves = {}; }))).toEqual(['Cheaper rides must now include a bag.']);
  });
  it('no change at all says so', () => {
    expect(prev(edit(() => undefined))).toEqual(['This changes nothing for now.']);
  });
  it('every preview line is short and has no tech words', () => {
    const lines = [
      ...prev(edit((c) => { c.weeklyCapCents.maya = 3000; })),
      ...prev(edit((c) => { c.adultsOnlyActions = []; c.floor.childrenNoUnlock = false; })),
      ...prev(edit((c) => { c.quietHours = { fromHour: 21, toHour: 6 }; })),
      ...prev(edit((c) => { c.floor.guestsNoBuy = false; })),
    ];
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines) {
      for (const s of line.split(/(?<=[.!?])\s+/)) expect(s.split(/\s+/).length, s).toBeLessThan(12);
      for (const w of BANNED_WORDS) expect(line.toLowerCase(), line).not.toMatch(new RegExp(`\\b${w}\\b`));
    }
  });
});
