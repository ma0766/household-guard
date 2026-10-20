import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results/pw',
  timeout: 60000,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  use: { baseURL: 'http://127.0.0.1:8016', screenshot: 'off', viewport: { width: 1400, height: 1000 } },
  webServer: {
    command: 'npm run start:e2e',
    url: 'http://127.0.0.1:8016/healthz',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
