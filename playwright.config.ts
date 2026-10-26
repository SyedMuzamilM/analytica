import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: 'http://localhost:8790', trace: 'retain-on-failure' },
  projects: [{name:'chromium',use:{...devices['Desktop Chrome'], channel:'chromium'}}],
  webServer: { command:'node scripts/browser-server.mjs',url:'http://localhost:8790/healthz',reuseExistingServer:false,timeout:60000 },
});
