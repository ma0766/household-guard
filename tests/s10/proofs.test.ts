import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultRules, type RulesConfig } from '../../src/policy/rules.js';
import { previewChange } from '../../src/rules/preview.js';
import { DEMO_PEOPLE } from '../../src/core/household.js';

// The CI proofs: Cedar's solver checks ALL requests. These tests run the real tool (installed on first use).
beforeAll(() => { execFileSync('sh', ['scripts/install-prover.sh'], { stdio: 'pipe' }); }, 300_000);

const tmp = mkdtempSync(join(tmpdir(), 'hg-s10-'));
let n = 0;
const rulesFile = (c: RulesConfig) => { const p = join(tmp, `r${n++}.json`); writeFileSync(p, JSON.stringify(c)); return p; };
const edit = (f: (c: RulesConfig) => void): RulesConfig => { const c: RulesConfig = JSON.parse(JSON.stringify(defaultRules())); f(c); return c; };
const prove = (args: string[], env: Record<string, string> = {}) => {
  const r = spawnSync('npx', ['tsx', 'scripts/prove.ts', ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('S10 proofs: the rules that ship keep the promises', () => {
  it('no child may unlock, no child may open the garage, no guest may use an app or buy — for every possible request', () => {
    const r = prove([]);
    expect(r.code).toBe(0);
    expect(r.out.match(/^PROVEN /gm)).toHaveLength(8); // four promises (door, garage, app, buying), each for the do-it and the hold set
    expect(r.out).not.toMatch(/FAILED/);
  });
  it('the default rule card config proves too (the cards generate the same rules)', () => {
    expect(prove(['--rules', rulesFile(defaultRules())]).code).toBe(0);
  });
});

describe('S10 proofs: a rule that breaks a promise fails with a counterexample', () => {
  it('a household whose rules let a child unlock fails', () => {
    const r = prove(['--rules', rulesFile(edit((c) => { c.adultsOnlyActions = ['garage']; c.floor.childrenNoUnlock = false; }))]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/FAILED {2}no child may unlock a door/);
    expect(r.out).toMatch(/action: Action::"unlock"/);
    expect(r.out).toMatch(/Role::"child"/); // the counterexample names who got through
  });
  it('a pull request that adds a rule letting children unlock fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hg-pr-'));
    copyFileSync('src/policy/auto.cedar', join(dir, 'auto.cedar'));
    copyFileSync('src/policy/approvable.cedar', join(dir, 'approvable.cedar'));
    appendFileSync(join(dir, 'auto.cedar'), '\n@id("oops_children_unlock")\npermit(principal in Role::"child", action == Action::"unlock", resource);\n');
    // the two rules that forbid it are still there, so this is safe...
    expect(prove(['--policies-dir', dir]).code).toBe(0);
    // ...until someone also removes them
    const floorless = (t: string) => t.replace(/@id\("floor_children_no_unlock"\)\n[^\n]*\n?/, '').replace(/@id\("adults_only_unlock"\)\n[^\n]*\n?/, '');
    for (const f of ['auto.cedar', 'approvable.cedar']) {
      const p = join(dir, f);
      writeFileSync(p, floorless(execFileSync('cat', [p], { encoding: 'utf8' })));
    }
    const r = prove(['--policies-dir', dir]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/FAILED {2}no child may unlock a door \(done at once\)/);
  });
  it('a guest given a buying limit with the guest rule off fails', () => {
    const r = prove(['--rules', rulesFile(edit((c) => { c.floor.guestsNoBuy = false; c.weeklyCapCents.guest = 2000; c.perRequestCapCents.guest = 2000; }))]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/FAILED {2}no guest may buy \(done at once\)/);
  });
  it('a missing proof tool is a failure, never a pass', () => {
    const r = prove([], { PROVER_DIR: join(tmp, 'nothing-here') });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/not installed/);
  });
});

describe('S10 proofs: new rules compared with old rules', () => {
  const compare = (candidate: RulesConfig, base: RulesConfig = defaultRules()) => prove(['--rules', rulesFile(candidate), '--base-rules', rulesFile(base)]).out;
  it('same rules → equivalent', () => {
    expect(compare(defaultRules())).toMatch(/COMPARE done at once vs .*: equivalent/);
  });
  it('a higher limit → more permissive for buying', () => {
    expect(compare(edit((c) => { c.weeklyCapCents.maya = 3000; c.perRequestCapCents.maya = 3000; }))).toMatch(/COMPARE done at once vs .*: more permissive \(allows more for: purchase\)/);
  });
  it('a lower limit → less permissive', () => {
    expect(compare(edit((c) => { c.weeklyCapCents.maya = 1000; c.perRequestCapCents.maya = 1000; }))).toMatch(/COMPARE done at once vs .*: less permissive \(allows less for: purchase\)/);
  });
  it('quiet hours on → less permissive, in both the do-it and the hold sets', () => {
    const out = compare(edit((c) => { c.quietHours = { fromHour: 21, toHour: 6 }; }));
    expect(out).toMatch(/COMPARE done at once vs .*: less permissive/);
    expect(out).toMatch(/COMPARE held for an adult vs .*: less permissive/);
  });
});

describe('S10 the plain-language preview and the proof agree', () => {
  const people = DEMO_PEOPLE;
  const cases: { name: string; change: RulesConfig; looser: boolean }[] = [
    { name: 'turning off the child-unlock rule alone (adults-only still blocks)', change: edit((c) => { c.floor.childrenNoUnlock = false; }), looser: false },
    { name: 'opening unlock to everyone and turning the rule off', change: edit((c) => { c.adultsOnlyActions = ['garage']; c.floor.childrenNoUnlock = false; }), looser: true },
    { name: 'opening the garage to everyone', change: edit((c) => { c.adultsOnlyActions = ['unlock']; }), looser: true },
    { name: 'a higher limit', change: edit((c) => { c.weeklyCapCents.maya = 3000; c.perRequestCapCents.maya = 3000; }), looser: true },
    { name: 'quiet hours', change: edit((c) => { c.quietHours = { fromHour: 21, toHour: 6 }; }), looser: false },
  ];
  for (const k of cases) {
    it(`${k.name}: the preview ${k.looser ? 'warns' : 'does not warn'} and the proof ${k.looser ? 'finds it more permissive' : 'does not'}`, () => {
      const lines = previewChange(defaultRules(), k.change, people);
      const warns = lines.some((l) => /lets|Are you sure/.test(l));
      const out = prove(['--rules', rulesFile(k.change), '--base-rules', rulesFile(defaultRules())]).out;
      const moreAnywhere = /: (more permissive|different)/.test(out);
      expect(warns, lines.join(' | ')).toBe(k.looser);
      expect(moreAnywhere, out).toBe(k.looser);
    });
  }
});
