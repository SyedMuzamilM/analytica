import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig(async () => ({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: {
      bindings: {
        TEST_MIGRATIONS: await readD1Migrations('./migrations'),
        APP_SECRET: 'test-only-application-secret-which-is-not-a-real-secret-123456',
        SETUP_TOKEN: 'test-only-setup-token-which-is-not-a-real-secret-123456',
        APP_ORIGIN: 'https://analytica.test',
        MODE: 'self-hosted',
      },
    },
  })],
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 15000,
  },
}));
