import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tour } from './qlib.js';

// Audit Part C: zero console errors and zero unhandled rejections during the tour.
// The trace recorder injects a snapshot script into the sandboxed frames and Chrome logs "Blocked script execution" for IT, not for the page
// (proof: audit/2026-10-21/F1-trace-artifact-probe.mjs.txt). A console check must look at the page, so this file runs with tracing off; video stays on.
test.use({ trace: 'off' });
const date = process.env.AUDIT_DATE ?? '2026-10-21';
const target = process.env.AUDIT_TARGET ?? 'local';
const dir = `audit/${date}`; mkdirSync(dir, { recursive: true });
const consoleErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.addEventListener('unhandledrejection', (e) => console.error('UNHANDLED_REJECTION ' + String(e.reason))); });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR ' + e.message));
});

test('C2 console: zero errors and zero unhandled rejections during the tour', async ({ page }) => {
  await tour(page);
  writeFileSync(`${dir}/C-console-${target}.json`, JSON.stringify(consoleErrors, null, 2));
  expect(consoleErrors).toEqual([]);
});

