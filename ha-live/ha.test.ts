import { beforeAll, describe, expect, it } from 'vitest';
import { newHousehold, speakAs } from '../tests/helpers.js';
import { requestAction } from '../src/core/request-action.js';
import { defaultHome } from '../src/connectors/home-assistant.js';
import { phoneConfirm } from '../src/identity/confirm.js';
import { getChallenge } from '../src/approvals/challenge.js';

// S14, for real: the official Home Assistant image with its demo devices, the same rules in front of it.
beforeAll(() => { process.loadEnvFile('.env.ha'); });
const state = async (id: string) => (await (await fetch(`${process.env.HG_HA_URL}/api/states/${id}`, { headers: { authorization: `Bearer ${process.env.HG_HA_TOKEN}` } })).json()) as { state: string; attributes: Record<string, any> };
const until = async <T>(f: () => Promise<T>, ok: (v: T) => boolean) => { let v = await f(); for (let i = 0; i < 20 && !ok(v); i++) { await new Promise((r) => setTimeout(r, 500)); v = await f(); } return v; };
const home = (action: string, item?: string, value?: string | number) => ({ service: 'sim-home', action, item, value });
const ctxWithHome = () => { const h = defaultHome(); expect(h?.kind).toBe('home-assistant'); return newHousehold({ home: h }); };

describe('S14 live: Home Assistant (official image, local Docker)', () => {
  it('a teen turns the light off and on; the real light changes', async () => {
    const ctx = await ctxWithHome();
    await speakAs(ctx.store, ctx.hh, 'maya');
    expect(await requestAction(ctx.deps, ctx.hh, home('light', 'lights', 'off'))).toMatchObject({ outcome: 'allowed', done: true });
    expect((await until(() => state('light.ceiling_lights'), (s) => s.state === 'off')).state).toBe('off');
    expect(await requestAction(ctx.deps, ctx.hh, home('light', 'lights', 'on'))).toMatchObject({ done: true });
    expect((await until(() => state('light.ceiling_lights'), (s) => s.state === 'on')).state).toBe('on');
  });
  it('the thermostat follows a normal setting; an extreme one is held and the real thermostat does not move', async () => {
    const ctx = await ctxWithHome();
    await speakAs(ctx.store, ctx.hh, 'maya');
    expect((await requestAction(ctx.deps, ctx.hh, home('thermostat', 'thermostat', 71))).done).toBe(true);
    const s = await until(() => state('climate.heatpump'), (x) => x.attributes.temperature === 71);
    expect(s.attributes.temperature).toBe(71);
    expect((await requestAction(ctx.deps, ctx.hh, home('thermostat', 'thermostat', 95))).outcome).toBe('held');
    expect((await state('climate.heatpump')).attributes.temperature).toBe(71);
  });
  it('a device its owner did not expose is out of reach even for the house (Home Assistant itself refuses)', async () => {
    const { HomeAssistantHome, DEFAULT_NAMES } = await import('../src/connectors/home-assistant.js');
    const h = new HomeAssistantHome(process.env.HG_HA_URL!, process.env.HG_HA_TOKEN!, { ...DEFAULT_NAMES, lock: 'Kitchen Door' });
    await expect(h.run('unlock', 'kitchen door', undefined)).rejects.toThrow();
    expect((await state('lock.kitchen_door')).state).toBe('unlocked'); // untouched (it started unlocked); the point is the call failed
  });
  it('a teen cannot unlock the real door (the rules say no); Mom can, after her own phone tap', async () => {
    const ctx = await ctxWithHome();
    await fetch(`${process.env.HG_HA_URL}/api/services/lock/lock`, { method: 'POST', headers: { authorization: `Bearer ${process.env.HG_HA_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ entity_id: 'lock.front_door' }) });
    await until(() => state('lock.front_door'), (s) => s.state === 'locked');
    await speakAs(ctx.store, ctx.hh, 'maya');
    expect((await requestAction(ctx.deps, ctx.hh, home('unlock', 'front door'))).outcome).toBe('denied');
    expect((await state('lock.front_door')).state).toBe('locked');
    await speakAs(ctx.store, ctx.hh, 'mom');
    const r = await requestAction(ctx.deps, ctx.hh, home('unlock', 'front door'));
    expect(r.next).toBe('confirm_on_phone');
    expect((await state('lock.front_door')).state).toBe('locked'); // nothing happens until she taps
    const c = (await getChallenge(ctx.deps, ctx.hh, r.job_id as string))!;
    await phoneConfirm(ctx.deps, ctx.hh, 'mom', { challenge_id: c.id, number: c.number });
    expect((await until(() => state('lock.front_door'), (s) => s.state === 'unlocked')).state).toBe('unlocked');
    await fetch(`${process.env.HG_HA_URL}/api/services/lock/lock`, { method: 'POST', headers: { authorization: `Bearer ${process.env.HG_HA_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ entity_id: 'lock.front_door' }) });
  });
  it('with the wrong key Home Assistant says no, and the answer is a hold', async () => {
    process.env.HG_HA_TOKEN_REAL = process.env.HG_HA_TOKEN;
    process.env.HG_HA_TOKEN = 'wrong-key';
    const ctx = await ctxWithHome();
    process.env.HG_HA_TOKEN = process.env.HG_HA_TOKEN_REAL;
    await speakAs(ctx.store, ctx.hh, 'maya');
    expect(await requestAction(ctx.deps, ctx.hh, home('light', 'lights', 'off'))).toMatchObject({ outcome: 'held', done: false });
  });
});
