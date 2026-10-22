import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePolicies, type RulesConfig } from '../src/policy/rules.js';

// Rule proofs. Cedar's solver-based analysis (symcc + cvc5) checks ALL possible requests, not a list of examples.
//   npm run prove                                  the rules that ship (src/policy/*.cedar) keep the fixed promises
//   npm run prove -- --rules house.json            a household's rules (a rule-card config) keep them
//   npm run prove -- --policies-dir some/dir       any pair of auto.cedar + approvable.cedar
//   ... --base-ref origin/main | --base-rules old.json | --base-policies-dir dir
//                                                  also say: equivalent / more permissive / less permissive than the base
// Exit 0: every promise proven. Exit 1: a promise broke (a counterexample is printed). Exit 2: the proof tools are missing.
const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const dir = process.env.PROVER_DIR ?? 'tools/prover';
const CEDAR = process.env.CEDAR_CLI ?? join(dir, 'cedar');
const CVC5 = process.env.CVC5 ?? join(dir, 'cvc5');
if (!existsSync(CEDAR) || !existsSync(CVC5)) {
  console.error('The proof tools are not installed. Run: npm run prover:install');
  process.exit(2);
}

type Sets = { auto: string; approvable: string };

// The one assumption every proof makes, stated as a rule added to BOTH sides: a person has exactly one role.
// (The app builds each person with a single role, so a "child who is also an adult" cannot exist; without this the
// solver invents one and reports differences no real household could have.)
const ROLE_NAMES = ['adult', 'teen', 'child', 'guest'];
const ONE_ROLE = ROLE_NAMES.flatMap((a, i) => ROLE_NAMES.slice(i + 1).map((b) => `(principal in Role::"${a}" && principal in Role::"${b}")`)).join(' || ');
const ASSUME = `@id("assume_one_role")\nforbid(principal, action, resource) when { ${ONE_ROLE} };\n`;
const withIds = (rec: Record<string, string>) => Object.entries(rec).map(([id, t]) => `@id(${JSON.stringify(id)})\n${t}`).join('\n\n') + '\n';
const fromRules = (c: RulesConfig): Sets => { const g = generatePolicies(c); return { auto: withIds(g.auto), approvable: withIds(g.approvable) }; };
const fromDir = (d: string): Sets => ({ auto: readFileSync(join(d, 'auto.cedar'), 'utf8'), approvable: readFileSync(join(d, 'approvable.cedar'), 'utf8') });
const fromRef = (ref: string): Sets => ({
  auto: execFileSync('git', ['show', `${ref}:src/policy/auto.cedar`], { encoding: 'utf8' }),
  approvable: execFileSync('git', ['show', `${ref}:src/policy/approvable.cedar`], { encoding: 'utf8' }),
});

const rulesFile = opt('--rules');
const candidate: Sets = rulesFile ? fromRules(JSON.parse(readFileSync(rulesFile, 'utf8'))) : fromDir(opt('--policies-dir') ?? 'src/policy');
const baseLabel = opt('--base-ref') ?? opt('--base-rules') ?? opt('--base-policies-dir');
const base: Sets | undefined = opt('--base-ref') ? fromRef(opt('--base-ref')!) : opt('--base-rules') ? fromRules(JSON.parse(readFileSync(opt('--base-rules')!, 'utf8'))) : opt('--base-policies-dir') ? fromDir(opt('--base-policies-dir')!) : undefined;

const work = mkdtempSync(join(tmpdir(), 'hg-prove-'));
let n = 0;
const file = (text: string) => { const p = join(work, `p${n++}.cedar`); writeFileSync(p, `${text}\n${ASSUME}`); return p; };

// One question to the solver. The tool prints its verdict in words and exits 0 either way, so we read the words.
function ask(action: string, kind: 'disjoint' | 'implies', one: string, two: string): { holds: boolean; counterexample: string } {
  let out: string;
  try {
    out = execFileSync(CEDAR, ['symcc', '--principal-type', 'Person', '--action', `Action::"${action}"`, '--resource-type', 'Service', '--schema', 'src/policy/schema.cedarschema', kind, '--policies1', file(one), '--policies2', file(two)], { encoding: 'utf8', env: { ...process.env, CVC5 }, timeout: 120_000 });
  } catch (e: any) {
    return { holds: false, counterexample: `the proof tool failed: ${String(e.stderr ?? e.message).slice(0, 400)}` }; // never "proven" by accident
  }
  if (out.includes('VERIFIED')) return { holds: true, counterexample: '' };
  return { holds: false, counterexample: out.split('Counterexample found:')[1]?.trim() ?? out.trim() };
}

// The fixed promises. Each is written as a rule that WOULD allow the forbidden thing; the proof says no request is allowed by both.
const PROMISES = [
  { name: 'no child may unlock a door', action: 'unlock', bad: 'permit(principal in Role::"child", action == Action::"unlock", resource);' },
  { name: 'no child may open the garage', action: 'garage', bad: 'permit(principal in Role::"child", action == Action::"garage", resource);' },
  { name: 'no guest may use an app', action: 'use_app', bad: 'permit(principal in Role::"guest", action == Action::"use_app", resource);' },
  { name: 'no child may hear a gift order', action: 'order_gift', bad: 'permit(principal in Role::"child", action == Action::"order_gift", resource);' },
  { name: 'no teen may hear a gift order', action: 'order_gift', bad: 'permit(principal in Role::"teen", action == Action::"order_gift", resource);' },
  { name: 'no guest may hear a gift order', action: 'order_gift', bad: 'permit(principal in Role::"guest", action == Action::"order_gift", resource);' },
  { name: 'no guest may hear order history', action: 'order_history', bad: 'permit(principal in Role::"guest", action == Action::"order_history", resource);' },
  { name: 'no guest may unlock a door', action: 'unlock', bad: 'permit(principal in Role::"guest", action == Action::"unlock", resource);' },
  { name: 'no guest may open the garage', action: 'garage', bad: 'permit(principal in Role::"guest", action == Action::"garage", resource);' },
  { name: 'no guest may buy', action: 'purchase', bad: 'permit(principal in Role::"guest", action == Action::"purchase", resource);' },
];
const lines: string[] = [];
const say = (s: string) => { console.log(s); lines.push(s); };
let broken = 0;

for (const p of PROMISES) {
  for (const set of ['auto', 'approvable'] as const) {
    const r = ask(p.action, 'disjoint', candidate[set], p.bad);
    if (r.holds) say(`PROVEN  ${p.name} (${set === 'auto' ? 'done at once' : 'or held for an adult'})`);
    else {
      broken++;
      say(`FAILED  ${p.name} (${set === 'auto' ? 'done at once' : 'or held for an adult'})`);
      say(r.counterexample.split('\n').map((l) => `        ${l}`).join('\n'));
    }
  }
}

if (base) {
  for (const set of ['auto', 'approvable'] as const) {
    const looser = new Set<string>();
    const stricter = new Set<string>();
    for (const action of ['light', 'thermostat', 'unlock', 'garage', 'purchase', 'use_app', 'build_site', 'order_history', 'order_status', 'cart', 'order_gift']) {
      const noMore = ask(action, 'implies', candidate[set], base[set]).holds; // everything the new rules allow, the old allowed
      const noLess = ask(action, 'implies', base[set], candidate[set]).holds; // everything the old rules allowed, the new allow
      if (!noMore) looser.add(action);
      if (!noLess) stricter.add(action);
    }
    const verdict = !looser.size && !stricter.size ? 'equivalent' : looser.size && stricter.size ? 'different' : looser.size ? 'more permissive' : 'less permissive';
    const detail = [looser.size ? `allows more for: ${[...looser].join(', ')}` : '', stricter.size ? `allows less for: ${[...stricter].join(', ')}` : ''].filter(Boolean).join('; ');
    say(`COMPARE ${set === 'auto' ? 'done at once' : 'held for an adult'} vs ${baseLabel}: ${verdict}${detail ? ` (${detail})` : ''}`);
  }
}

say(broken ? `${broken} promise(s) broken.` : 'Every promise is proven for all requests.');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Rule proofs\n```\n' + lines.join('\n') + '\n```\n');
process.exit(broken ? 1 : 0);
