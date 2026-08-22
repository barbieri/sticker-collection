import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:4173/fifa-wc2026/en-US',
    permissions: ['clipboard-read', 'clipboard-write'],
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'corepack pnpm run build && corepack pnpm exec serve dist -l 4173',
    url: 'http://127.0.0.1:4173/fifa-wc2026/en-US/#album',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
