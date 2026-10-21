import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freshHouse, signIn, confirmOnPhone } from './helpers.js';

test('S10: the rule card says what the change would do BEFORE the tap, and quiet hours switch on', async ({ page }) => {
  await page.goto(freshHouse());
  const preview = page.getByTestId('rule-preview');
  const rules = page.frameLocator('[data-testid="rules-frame"]');
  await signIn(page, 'mom');
  await page.getByTestId('rule-maya-limit').fill('30');
  await page.getByTestId('rule-save-maya').click();
  await expect(preview).toHaveText('This lets Maya spend $10 more a week.');
  await page.screenshot({ path: 'test-results/s10-preview-before-tap.png' });
  await confirmOnPhone(page, 'mom');
  await expect(rules.getByText('Maya: $30 a week.')).toBeVisible();
  await page.getByTestId('rule-quiet-on').click();
  await expect(preview).toHaveText('Kids cannot buy from 9 PM to 6 AM.');
  await confirmOnPhone(page, 'mom');
  await expect(rules.getByText('No buying for kids from 9 PM to 6 AM.')).toBeVisible();
  await page.screenshot({ path: 'test-results/s10-quiet-hours.png' });
});

// The CI check, run for real: the shipped rules pass; a rule that lets a child unlock fails with a counterexample.
test('S10: the proof passes on the shipped rules and FAILS when a rule lets a child unlock', async () => {
  execFileSync('sh', ['scripts/install-prover.sh'], { stdio: 'pipe' });
  const good = spawnSync('npm', ['run', '--silent', 'prove'], { encoding: 'utf8' });
  expect(good.status).toBe(0);
  expect(good.stdout).toContain('Every promise is proven for all requests.');

  // a "pull request" that opens the front door to everyone
  const dir = mkdtempSync(join(tmpdir(), 'hg-e2e-pr-'));
  for (const f of ['auto.cedar', 'approvable.cedar']) {
    copyFileSync(`src/policy/${f}`, join(dir, f));
    writeFileSync(join(dir, f), readFileSync(join(dir, f), 'utf8').replace(/@id\("(floor_children_no_unlock|adults_only_unlock)"\)\n[^\n]*\n?/g, ''));
  }
  appendFileSync(join(dir, 'auto.cedar'), '\n@id("anyone_unlocks")\npermit(principal, action == Action::"unlock", resource);\n');
  const bad = spawnSync('npm', ['run', '--silent', 'prove', '--', '--policies-dir', dir], { encoding: 'utf8' });
  expect(bad.status).toBe(1);
  expect(bad.stdout).toMatch(/FAILED {2}no child may unlock a door \(done at once\)/);
  expect(bad.stdout).toMatch(/principal: Person::"[^"]*" in \[Role::"child"\]|Role::"child"/);
  writeFileSync('test-results/s10-ci-proof-failure.txt', bad.stdout);
});
