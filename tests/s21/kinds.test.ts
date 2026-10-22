import { describe, expect, it } from 'vitest';
import { newHousehold, speakAs } from '../helpers.js';
import { requestAction } from '../../src/core/request-action.js';
import { proposeRule } from '../../src/rules/change.js';
import { Store } from '../../src/core/store.js';
import { defaultRules, KNOWN_ACTIONS, ORDER_ACTIONS } from '../../src/policy/rules.js';
import { kindOf, serviceKnownFor, DEFAULT_SERVICE_KINDS } from '../../src/policy/kinds.js';
import { home, ride, tap } from '../s20/helpers.js';

describe('six kinds of action', () => {
  it('every action the house knows is one of the six kinds', () => {
    for (const a of [...KNOWN_ACTIONS, ...ORDER_ACTIONS, 'why', 'unlock', 'camera', 'vacuum']) expect(kindOf(a), a).toBeTruthy();
    expect(kindOf('delete_account')).toBeUndefined();
  });
  it('the shipped services declare their kinds', () => {
    expect(DEFAULT_SERVICE_KINDS['sim-home']).toEqual(['info', 'control', 'access']);
    expect(serviceKnownFor(defaultRules(), 'mock-ride', 'purchase')).toBe(true);
    expect(serviceKnownFor(defaultRules(), 'mock-ride', 'light')).toBe(false); // a ride service does not offer control
  });
  it('info and control: anyone, no tap', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'leo', 'pin');
    for (const a of [home('weather'), home('light', 'lights', 'on'), home('music', 'jazz')]) expect(await requestAction(ctx.deps, ctx.hh, a)).toMatchObject({ outcome: 'allowed', done: true });
  });
  it('money: a tap on your own phone, inside limits', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    expect(await requestAction(ctx.deps, ctx.hh, ride('mall'))).toMatchObject({ outcome: 'allowed', next: 'confirm_on_phone' });
    expect((await requestAction(ctx.deps, ctx.hh, ride('airport'))).outcome).toBe('held');
  });
  it('access: adults, with a tap. Everyone else is refused', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    expect(await requestAction(ctx.deps, ctx.hh, home('unlock', 'front door'))).toMatchObject({ outcome: 'allowed', next: 'confirm_on_phone', tier: 'high' });
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    expect((await requestAction(ctx.deps, ctx.hh, home('unlock', 'front door'))).outcome).toBe('denied');
  });
  it('acting in your name: an adult, with a tap; others are held', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    expect(await requestAction(ctx.deps, ctx.hh, { service: 'wix', action: 'build_site', item: 'a site' })).toMatchObject({ outcome: 'allowed', next: 'confirm_on_phone' });
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    expect((await requestAction(ctx.deps, ctx.hh, { service: 'wix', action: 'build_site', item: 'a site' })).outcome).toBe('held');
  });
});

describe('undeclared = hold', () => {
  it('a service the house allowed but that never said what it offers is held for an adult, and goes ahead once it declares', async () => {
    const ctx = await newHousehold();
    const put = (config: unknown) => ctx.store.put({ pk: Store.hk(ctx.hh), sk: 'RULES#current', config });
    await put({ ...defaultRules(), allowedServices: [...defaultRules().allowedServices, 'mock-food'] });
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const held = await requestAction(ctx.deps, ctx.hh, { service: 'mock-food', action: 'purchase', item: 'book' });
    expect(held.outcome).toBe('held');
    await put({ ...defaultRules(), allowedServices: [...defaultRules().allowedServices, 'mock-food'], serviceKinds: { 'mock-food': ['control'] } });
    expect((await requestAction(ctx.deps, ctx.hh, { service: 'mock-food', action: 'purchase', item: 'book' })).outcome).toBe('held'); // declared control, not money: still held
  });
  it('a service that declares only info cannot be used to control', async () => {
    const ctx = await newHousehold();
    await ctx.store.put({ pk: Store.hk(ctx.hh), sk: 'RULES#current', config: { ...defaultRules(), serviceKinds: { 'sim-home': ['info'] } } });
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    expect((await requestAction(ctx.deps, ctx.hh, home('light', 'lights', 'on'))).outcome).toBe('held');
    expect((await requestAction(ctx.deps, ctx.hh, home('weather'))).outcome).toBe('allowed');
  });
});

describe('a rule can aim at a whole kind', () => {
  it('"no controlling things for children" denies Leo\'s light and leaves Mom alone; an adult\'s tap saves it; undo removes it', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const r = await proposeRule(ctx.deps, ctx.hh, { change: { template: 'kind_rule', role: 'child', kind: 'control', effect: 'deny' } });
    expect(r.status).toBe('waiting');
    expect(r.sentence).toBe('No controlling things for children.');
    await speakAs(ctx.store, ctx.hh, 'leo', 'pin');
    expect((await requestAction(ctx.deps, ctx.hh, home('light', 'lights', 'on'))).outcome).toBe('allowed'); // not saved before the tap
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    await tap(ctx, 'mom', r.challenge_id!);
    await speakAs(ctx.store, ctx.hh, 'leo', 'pin');
    const no = await requestAction(ctx.deps, ctx.hh, home('light', 'lights', 'on'));
    expect(no.outcome).toBe('denied');
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    expect((await requestAction(ctx.deps, ctx.hh, home('light', 'lights', 'on'))).outcome).toBe('allowed');
    const u = await proposeRule(ctx.deps, ctx.hh, { undo: true });
    await tap(ctx, 'mom', u.challenge_id!);
    await speakAs(ctx.store, ctx.hh, 'leo', 'pin');
    expect((await requestAction(ctx.deps, ctx.hh, home('light', 'lights', 'on'))).outcome).toBe('allowed');
  });
  it('"teens need an adult\'s yes for money" holds even a small ride; looking things up cannot be switched off for kids', async () => {
    const ctx = await newHousehold();
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    const r = await proposeRule(ctx.deps, ctx.hh, { change: { template: 'kind_rule', role: 'teen', kind: 'money', effect: 'needs_approval' } });
    await tap(ctx, 'mom', r.challenge_id!);
    await speakAs(ctx.store, ctx.hh, 'maya', 'phone');
    expect((await requestAction(ctx.deps, ctx.hh, ride('school', 'shared'))).outcome).toBe('held');
    await speakAs(ctx.store, ctx.hh, 'mom', 'phone');
    expect((await proposeRule(ctx.deps, ctx.hh, { change: { template: 'kind_rule', role: 'child', kind: 'info', effect: 'deny' } })).status).toBe('invalid');
  });
});
