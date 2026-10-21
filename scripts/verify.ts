import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';

// verify = lint + typecheck + unit/replay + e2e, then a per-slice PASS/FAIL table
const SLICES: Record<string, string> = {
  S0: 'Walking skeleton',
  S1: 'First decision: lights',
  S2: 'Who is speaking',
  S3: 'Money: the ride',
  S4: 'Approvals + a yes that fits',
  S5: 'Risk check',
  S6: 'Audit and status',
  S7: 'Editable rules + full replay',
  S8: 'Hardening + submission pack',
  S9: 'Real screens with MCP Apps',
  S10: 'Rule proofs in CI + quiet hours',
  S11: 'Self-healing demo',
  S12: 'Sign-in + approvals by email (email send: stand-in)',
};
mkdirSync('test-results', { recursive: true });
const run = (label: string, cmd: string, args: string[]) => {
  console.log(`\n▶ ${label}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  return r.status === 0;
};

const steps = {
  lint: run('lint', 'npx', ['eslint', '.']),
  typecheck: run('typecheck', 'npx', ['tsc', '--noEmit']),
  unit: run('unit + replay tests', 'npx', ['vitest', 'run', '--reporter=default', '--reporter=json', '--outputFile.json=test-results/unit.json']),
  e2e: run('e2e', 'npx', ['playwright', 'test']),
};

type Tally = { pass: number; fail: number };
const tally: Record<string, Tally> = Object.fromEntries(Object.keys(SLICES).map((k) => [k, { pass: 0, fail: 0 }]));
const sliceOf = (file: string): string | undefined => {
  const m = file.match(/(?:tests\/s|e2e\/s)(\d+)/);
  if (m) return `S${m[1]}`;
  if (file.includes('tests/replay/')) return 'S1';
  return undefined;
};

if (existsSync('test-results/unit.json')) {
  const j = JSON.parse(readFileSync('test-results/unit.json', 'utf8'));
  for (const f of j.testResults ?? []) {
    const s = sliceOf(f.name);
    if (!s) continue;
    for (const a of f.assertionResults) if (!['pending', 'skipped', 'todo'].includes(a.status)) tally[s][a.status === 'passed' ? 'pass' : 'fail']++; // a skipped live-Bedrock test is not a failure
    if (f.status === 'failed' && f.assertionResults.length === 0) tally[s].fail++;
  }
}
if (existsSync('test-results/e2e.json')) {
  const j = JSON.parse(readFileSync('test-results/e2e.json', 'utf8'));
  const walk = (suite: any) => {
    for (const sp of suite.specs ?? []) {
      const s = sliceOf(`e2e/${sp.file}`);
      if (!s) continue;
      tally[s][sp.ok ? 'pass' : 'fail']++;
    }
    for (const c of suite.suites ?? []) walk(c);
  };
  for (const s of j.suites ?? []) walk(s);
}

console.log('\n| Slice | Name | Result | Passed | Failed |\n|---|---|---|---|---|');
let allPass = Object.values(steps).every(Boolean);
for (const [k, name] of Object.entries(SLICES)) {
  const t = tally[k];
  const ok = t.pass > 0 && t.fail === 0;
  if (!ok) allPass = false;
  console.log(`| ${k} | ${name} | ${ok ? 'PASS' : 'FAIL'} | ${t.pass} | ${t.fail} |`);
}
console.log(`\nlint:${steps.lint ? 'ok' : 'FAIL'} typecheck:${steps.typecheck ? 'ok' : 'FAIL'} unit:${steps.unit ? 'ok' : 'FAIL'} e2e:${steps.e2e ? 'ok' : 'FAIL'}`);
process.exit(allPass ? 0 : 1);
