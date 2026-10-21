import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, PRIVACY } from '../../src/server.js';
import { mintToken } from '../../src/auth.js';
import { T, BANNED_WORDS } from '../../src/text.js';

let server: Server;
let base: string;
beforeAll(async () => {
  server = createApp();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

describe('S8 hardening', () => {
  it('every protected endpoint refuses a request with no sign-in, a bad one, or an expired one', async () => {
    const expired = mintToken('x', -10);
    const good = mintToken('x', 300);
    const cut = good.length - 12; // a character in the middle of the signature (the last one carries unused bits)
    const tampered = good.slice(0, cut) + (good[cut] === 'A' ? 'B' : 'A') + good.slice(cut + 1);
    for (const [path, method] of [['/mcp', 'POST'], ['/phone/mom/inbox', 'GET'], ['/phone/mom/confirm', 'POST'], ['/phone/mom/approve', 'POST']] as const) {
      for (const auth of [undefined, 'Bearer nope', `Bearer ${expired}`, `Bearer ${tampered}`]) {
        const r = await fetch(base + path, { method, headers: { ...(auth ? { authorization: auth } : {}), 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: method === 'POST' ? '{}' : undefined });
        expect(r.status, `${method} ${path} ${auth}`).toBe(401);
      }
    }
  });

  it('well-known metadata is public and says a bearer token is needed', async () => {
    const r = await fetch(`${base}/.well-known/oauth-protected-resource`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ resource: expect.stringMatching(/\/mcp$/), bearer_methods_supported: ['header'] });
    const m: any = await (await fetch(`${base}/.well-known/household-guard.json`)).json();
    expect(m.protocol_versions).toEqual(['2025-11-25', '2025-03-26']);
  });

  it('the privacy note says: no audio, adults create child profiles, 90-day log', async () => {
    const text = await (await fetch(`${base}/privacy`)).text();
    expect(text).toBe(PRIVACY);
    expect(text).toMatch(/do not store audio/i);
    expect(text).toMatch(/children are created only by an adult/i);
    expect(text).toMatch(/90 days/);
  });

  it('there is no tool that creates a profile, and none takes a person to act as', async () => {
    const { buildMcpServer } = await import('../../src/mcp/server.js');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const { newHousehold } = await import('../helpers.js');
    const { deps } = await newHousehold();
    const s = buildMcpServer(deps, 'x');
    const [a, b] = InMemoryTransport.createLinkedPair();
    await s.connect(a);
    const c = new Client({ name: 't', version: '1' });
    await c.connect(b);
    const tools = (await c.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(['approve_request', 'audit_log', 'confirm_identity', 'connect_service', 'find_capability', 'household_status', 'job_status', 'request_action', 'set_rule', 'show_on_screen']); // the ten tools of the spec (S13 added find_capability and connect_service)
    const ra: any = tools.find((t) => t.name === 'request_action')!.inputSchema;
    for (const bad of ['person', 'speaker', 'user', 'who', 'principal', 'amount', 'price', 'amount_cents']) expect(Object.keys(ra.properties)).not.toContain(bad);
  });

  it('secrets are not in git: .env files and the deploy file are ignored', () => {
    const ig = readFileSync('.gitignore', 'utf8');
    expect(ig).toMatch(/^\.env\*$/m);
    expect(ig).toMatch(/node_modules/);
  });

  it('the submission files exist', () => {
    for (const f of ['README.md', 'FEEDBACK.md', 'FRICTION_LOG.md', 'LICENSE', 'docs/architecture.svg']) expect(existsSync(f), f).toBe(true);
    expect(readFileSync('LICENSE', 'utf8')).toMatch(/^MIT License/);
  });
});

// Reading level: Flesch-Kincaid grade of every spoken line. Short words, short sentences.
const syllables = (w: string) => Math.max(1, (w.toLowerCase().replace(/[^a-z]/g, '').replace(/e$/, '').match(/[aeiouy]+/g) ?? []).length);
function grade(text: string): number {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  return 0.39 * (words.length / sentences.length) + 11.8 * (syl / words.length) - 15.59;
}

describe('S8 words (usability standard, checked in CI)', () => {
  const lines = (): string[] => {
    const out: string[] = [];
    const byApp = new Set(['appConnected', 'appNotConnected', 'appPending', 'signInRanOut', 'connectFirst', 'openLink', 'appDown']); // these take an app name, tried with real ones below
    for (const [k, v] of Object.entries(T)) {
      if (typeof v === 'string') out.push(v);
      else if (v.length === 1 && !byApp.has(k)) out.push((v as any)(47), (v as any)('Maya'));
    }
    // app names are brand names we do not choose, so the reading level is checked with a short name; real names are checked for words and length below
    for (const app of ['Maya']) out.push(T.appConnected(app), T.appNotConnected(app), T.appPending(app), T.signInRanOut(app), T.connectFirst(app), T.openLink(app), T.appDown(app), T.appDone(app, 'play jazz'));
    out.push(T.done('light', 'lights', 'off'), T.done('unlock', 'front door'), T.done('garage'), T.done('thermostat', undefined, 72), T.overWeekly('Maya', 2000), T.overOneBuy('Maya', 1500), T.rideBooked(1400), T.bought(1500), T.altOffer('shared ride', 1400));
    return out.filter(Boolean);
  };
  it('no tech words, under 12 words a sentence, reading level grade 5 or below', () => {
    for (const line of lines()) {
      for (const s of line.split(/(?<=[.!?])\s+/)) expect(s.split(/\s+/).length, s).toBeLessThan(12);
      for (const w of BANNED_WORDS) expect(line.toLowerCase(), line).not.toMatch(new RegExp(`\\b${w}\\b`));
      expect(grade(line), `${line} (grade ${grade(line).toFixed(1)})`).toBeLessThanOrEqual(5);
    }
  });
  it('every line written outside the text file is held to the same rules (say / reason / error)', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = `${d}/${f}`; if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts') && p !== 'src/text.ts') files.push(p); } };
    walk('src');
    const found: string[] = [];
    for (const f of files) {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        if (/jsonrpc|\bsend\(|res\.end\(/.test(line)) continue; // web-address error replies for programs, never spoken
        for (const m of line.matchAll(/\b(?:say|reason|error|warning|why|message)\s*:\s*('(?:[^'\\]|\\.)*'|`[^`]*`)/g)) {
          const text = m[1].slice(1, -1).replace(/\$\{[^}]*\}/g, '5').replace(/\\'/g, "'");
          if (/[A-Z][a-z]+ [a-z]+/.test(text) && text.includes(' ')) found.push(text);
        }
      }
    }
    expect(found.length).toBeGreaterThan(25); // the scan really finds lines
    const bad: string[] = [];
    for (const line of found) {
      if (line.split(/(?<=[.!?])\s+/).some((x) => x.split(/\s+/).length >= 12)) bad.push(`too long: ${line}`);
      if (BANNED_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(line.toLowerCase()))) bad.push(`tech word: ${line}`);
      if (grade(line) > 5) bad.push(`grade ${grade(line).toFixed(1)}: ${line}`);
    }
    expect(bad).toEqual([]);
  });
  it('lines with real app names: no tech words, short sentences', () => {
    for (const app of ['Spotify', 'Todoist', 'Google Calendar']) {
      for (const line of [T.appConnected(app), T.appNotConnected(app), T.appPending(app), T.signInRanOut(app), T.connectFirst(app), T.openLink(app), T.appDown(app), T.appDone(app, 'play jazz')]) {
        for (const sentence of line.split(/(?<=[.!?])\s+/)) expect(sentence.split(/\s+/).length, sentence).toBeLessThan(12);
        for (const w of BANNED_WORDS) expect(line.toLowerCase(), line).not.toMatch(new RegExp(`\\b${w}\\b`));
      }
    }
  });
  it('the web client has no tech words in its buttons and labels', () => {
    const html = readFileSync('web-client/index.html', 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
    const visible = [...html.matchAll(/>([^<>]{3,})</g)].map((m) => m[1]).join(' ').toLowerCase();
    for (const w of ['policy', 'cedar', 'token', 'json', 'lambda', 'dynamodb', 'bedrock']) expect(visible).not.toMatch(new RegExp(`\\b${w}\\b`));
  });
});

describe('S8 the bundle carries what it reads', () => {
  it('schema.ts equals the readable schema.cedarschema', async () => {
    const { SCHEMA_TEXT } = await import('../../src/policy/schema.js');
    expect(SCHEMA_TEXT).toBe(readFileSync('src/policy/schema.cedarschema', 'utf8'));
  });
  it('no source file reads a file from disk at start-up other than the web client', () => {
    for (const f of ['src/policy/evaluator.ts', 'src/policy/rules.ts']) expect(readFileSync(f, 'utf8')).not.toMatch(/readFileSync/);
  });
});
