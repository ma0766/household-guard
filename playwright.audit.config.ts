import { readFileSync, existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Audit runs: Chromium, video + trace always on, evidence under audit/<date>/.
// AUDIT_TARGET=local (default, server already running on :8016) or prod (URL from .env.deploy).
const date = process.env.AUDIT_DATE ?? '2026-10-21';
const target = process.env.AUDIT_TARGET ?? 'local';
let baseURL = 'http://127.0.0.1:8016';
if (target === 'prod') {
  const l = existsSync('.env.deploy') ? readFileSync('.env.deploy', 'utf8').split('\n').find((x) => x.startsWith('HG_URL=')) : undefined;
  baseURL = l!.slice('HG_URL='.length).trim();
}
export default defineConfig({
  testDir: 'tests/audit',
  outputDir: `audit/${date}/pw-${target}/${process.env.AUDIT_GROUP ?? 'all'}`,
  timeout: 90000,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: `audit/${date}/results-${target}-${process.env.AUDIT_GROUP ?? 'all'}.json` }]],
  use: { baseURL, video: 'on', trace: (process.env.AUDIT_TRACE as 'on' | 'off') ?? 'on', screenshot: 'on', viewport: { width: 1400, height: 1000 }, browserName: 'chromium' },
});
