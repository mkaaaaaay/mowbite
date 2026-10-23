import {defineConfig, devices} from '@playwright/test';

// The click tests (e2e/). Without E2E_URL the built app (npm run build, out/) is served here and runs with the demo
// mower. With E2E_URL they go to a MowBite that runs with a mower or a simulator, the ones that need that only then
const url = process.env.E2E_URL;
const ci = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: {timeout: 15_000},
  retries: ci ? 1 : 0,
  workers: ci ? 2 : undefined,
  reporter: ci ? [['list'], ['html', {open: 'never'}]] : 'list',
  use: {
    baseURL: url ?? 'http://localhost:3123',
    locale: 'en-US',
    timezoneId: 'Europe/Berlin',
    // the chrome on this computer, CI brings its own (playwright install chromium)
    ...(ci ? {} : {channel: 'chrome'}),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {name: 'phone', use: {...devices['Pixel 7']}},
    {name: 'desktop', use: {...devices['Desktop Chrome']}},
  ],
  webServer: url ? undefined : {command: 'node e2e/serve.mjs', url: 'http://localhost:3123', reuseExistingServer: !ci},
});
