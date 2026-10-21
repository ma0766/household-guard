import { defineConfig } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { currentStage } from './scripts/stage.js';

// Browser checks against a DEPLOYED stage (default: roadmap). Needs that stage's gitignored env file. Run: npm run e2e:live
const env: Record<string, string> = {};
const file = currentStage().envFile;
if (existsSync(file)) for (const l of readFileSync(file, 'utf8').split('\n')) { const [k, ...v] = l.split('='); if (k) env[k] = v.join('='); }
Object.assign(process.env, { LIVE_URL: env.HG_URL, LIVE_USER: env.HG_TEST_USER, LIVE_PASSWORD: env.HG_TEST_PASSWORD });
export default defineConfig({
  testDir: 'e2e-live',
  outputDir: 'test-results/pw-live',
  timeout: 90000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: env.HG_URL, screenshot: 'off', viewport: { width: 1400, height: 1000 } },
});
