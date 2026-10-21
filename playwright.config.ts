import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results/pw',
  timeout: 60000,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  use: { baseURL: 'http://127.0.0.1:8016', screenshot: 'off', viewport: { width: 1400, height: 1000 } },
  webServer: [
    // a stand-in for the family-account sign-in server (S12)
    { command: 'npx tsx e2e/fake-oidc-server.ts', url: 'http://127.0.0.1:8019/.well-known/jwks.json', reuseExistingServer: false, timeout: 60000 },
    {
      command: 'npm run start:e2e',
      url: 'http://127.0.0.1:8016/healthz',
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        HG_OIDC_ISSUER: 'http://127.0.0.1:8019',
        HG_OIDC_JWKS_URI: 'http://127.0.0.1:8019/.well-known/jwks.json',
        HG_OIDC_CLIENT_IDS: 'web-client',
        HG_OIDC_AUTHORIZE_URL: 'http://127.0.0.1:8019/oauth2/authorize',
        HG_OIDC_TOKEN_URL: 'http://127.0.0.1:8019/oauth2/token',
        HG_OIDC_WEB_CLIENT_ID: 'web-client',
        HG_PUBLIC_URL: 'http://127.0.0.1:8016',
        HG_APPROVER_EMAILS: '{"mom":"mom@example.test"}',
      },
    },
  ],
});
