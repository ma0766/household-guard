import { defineConfig } from 'vitest/config';

// The real Home Assistant (Docker) check. Needs `npm run ha:up` first. Run: npm run ha:test
export default defineConfig({ test: { include: ['ha-live/**/*.test.ts'], globalSetup: ['tests/global-setup.ts'], testTimeout: 60000, hookTimeout: 120000 } });
