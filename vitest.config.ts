import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { DDB_ENDPOINT: process.env.DDB_ENDPOINT ?? 'http://127.0.0.1:8018' }, // tests never touch the cloud table, signed in or not (CI points this at its DynamoDB Local service)
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    testTimeout: 30000,
    hookTimeout: 120000,
  },
});
