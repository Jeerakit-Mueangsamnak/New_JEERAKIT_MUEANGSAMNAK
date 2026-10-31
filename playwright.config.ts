import { defineConfig, devices } from '@playwright/test';
import { OWNER_STATE } from './e2e/helpers';

// E2E runs only against Supabase Local (supabase start); e2e/serve-local.mjs loads
// e2e/local-env.json over .env.local, which points at the real Cloud project.
export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  retries: 1,
  // Supabase Local in Docker (about 4 GB RAM here) times out under more parallel sessions.
  workers: 2,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        // Production build: dev mode compiles pages on first hit and is too slow for
        // Firefox/WebKit. Keep this server running between runs to skip the rebuild.
        command: 'node e2e/serve-local.mjs',
        url: 'http://127.0.0.1:3000/login',
        reuseExistingServer: true,
        timeout: 600000,
      },
  // Specs that write data (stock, bills, money) run on Chromium only, one at a time, so the
  // three browsers do not race on the same local database.
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: OWNER_STATE },
      dependencies: ['setup'],
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], storageState: OWNER_STATE },
      dependencies: ['setup'],
      testIgnore: /flow-.*\.spec\.ts/,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], storageState: OWNER_STATE },
      dependencies: ['setup'],
      testIgnore: /flow-.*\.spec\.ts/,
    },
  ],
});
