import { defineConfig, devices } from '@playwright/test';

/** 3.0: nessun server applicativo. Si prova la build statica servita da `vite preview`, come in produzione. */
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
    command: 'npx vite preview --port 3100 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:3100/',
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
  },
});
