import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

if (existsSync('../.env')) process.loadEnvFile('../.env');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'off', screenshot: 'only-on-failure' },
  projects: [{ name: 'iPhone 13', use: { ...devices['iPhone 13'], browserName: 'chromium', locale: 'it-IT', timezoneId: 'Europe/Rome' } }],
  webServer: {
    command: 'npx tsx ../server/src/e2eServer.ts',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
  },
});
