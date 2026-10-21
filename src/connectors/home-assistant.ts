import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { T } from '../text.js';

// A real smart home through Home Assistant's own MCP server (official image, run locally in Docker; /api/mcp). The rules have
// ALREADY decided before this runs. Two more fences: (1) Home Assistant only offers devices its owner exposed (it hides door
// locks until the owner says so), and (2) this file only ever calls the four tools below, by the device names listed here,
// whatever words a caller sends. Any error is thrown: the caller turns it into a hold, never a quiet "done".
export interface HomeBackend {
  readonly kind: 'home-assistant';
  run(action: string, item: string | undefined, value: string | number | undefined): Promise<void>;
}

export interface Names { light: string; thermostat: string; lock: string; garage: string }
export const DEFAULT_NAMES: Names = { light: 'Ceiling Lights', thermostat: 'HeatPump', lock: 'Front Door', garage: 'Garage Door' };
const SAFE_NAME = /^[A-Za-z0-9 ]{1,40}$/;

// What was said must name the device we are wired to. Anything else is refused (a hold), never mapped to some other device.
const ITEM_OK: Record<string, RegExp> = { light: /^(the |my )?(ceiling )?lights?$/i, unlock: /^(the |my )?front door$/i, garage: /^(the |my )?garage( door)?$/i, thermostat: /^(the |my )?(thermostat|heat|heating|temperature)$/i };

// The call may have reached the home even though we stopped waiting: the answer to the person is "not sure", never "failed".
export class HomeUnsure extends Error {}

export class HomeAssistantHome implements HomeBackend {
  readonly kind = 'home-assistant' as const;
  constructor(private url: string, private token: string, private names: Names = DEFAULT_NAMES, private timeoutMs = 2500) {}

  private async tool(name: string, args: Record<string, unknown>): Promise<void> {
    const client = new Client({ name: 'household-guard', version: '1' });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${this.url.replace(/\/$/, '')}/api/mcp`), { requestInit: { headers: { authorization: `Bearer ${this.token}` }, signal: ctl.signal } }));
      const r = (await client.callTool({ name, arguments: args }, undefined, { signal: ctl.signal })) as { isError?: boolean; content?: { type: string; text?: string }[] };
      if (r.isError) throw new Error('the home said no');
      // what it says back is data. The only thing read is whether it says the action was done for at least one device.
      const text = r.content?.find((c) => c.type === 'text')?.text ?? '{}';
      if (text.length > 65_536) throw new Error('reply too big');
      const j = JSON.parse(text);
      if (j?.response_type !== 'action_done' || !Array.isArray(j?.data?.success) || j.data.success.length < 1 || (j.data.failed?.length ?? 0) > 0) throw new Error('the home did not do it');
    } catch (e) {
      if (ctl.signal.aborted) throw new HomeUnsure('no answer in time');
      throw e;
    } finally {
      clearTimeout(timer);
      await client.close().catch(() => undefined);
    }
  }

  async run(action: string, item: string | undefined, value: string | number | undefined): Promise<void> {
    const n = this.names;
    if (item !== undefined && item !== '' && ITEM_OK[action] && !ITEM_OK[action].test(String(item).trim())) throw new Error('not a device we are wired to');
    switch (action) {
      case 'light':
        return this.tool(String(value) === 'off' ? 'intent__HassTurnOff' : 'intent__HassTurnOn', { name: n.light });
      case 'thermostat': {
        const t = Number(value);
        if (!Number.isFinite(t) || t < 40 || t > 100) throw new Error('not a believable temperature');
        return this.tool('climate__HassClimateSetTemperature', { name: n.thermostat, temperature: Math.round(t) });
      }
      case 'unlock':
        return this.tool('intent__HassTurnOff', { name: n.lock, domain: ['lock'] }); // Home Assistant: turning a lock "off" unlocks it
      case 'garage':
        return this.tool('intent__HassTurnOn', { name: n.garage, domain: ['cover'] }); // turning a cover "on" opens it
      default:
        throw new Error(T.cantDo); // nothing else is wired to the home
    }
  }
}

export function defaultHome(): HomeBackend | undefined {
  const url = process.env.HG_HA_URL;
  const token = process.env.HG_HA_TOKEN;
  if (!url || !token) return undefined; // no Home Assistant set up: the simulated home is used
  let names = DEFAULT_NAMES;
  try {
    if (process.env.HG_HA_NAMES) names = { ...DEFAULT_NAMES, ...JSON.parse(process.env.HG_HA_NAMES) };
  } catch {
    /* a bad value keeps the defaults */
  }
  if (!/^https:\/\//.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url)) return undefined; // a key never crosses a network in clear text
  for (const v of Object.values(names)) if (!SAFE_NAME.test(v)) return undefined; // an odd device name switches the connector off
  return new HomeAssistantHome(url, token, names);
}
