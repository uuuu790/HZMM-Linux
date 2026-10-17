import { defineConfig } from '@playwright/test';

// Packaged-app simulation suite (e2e/sim). Kept apart from the regular e2e
// run: it drives dist/linux-unpacked, not out/main, and needs Linux tooling.
// `*.sim.mjs` doesn't match Playwright's default *.spec / *.test pattern, so
// the main config never picks it up.
export default defineConfig({
  testDir: './e2e/sim',
  testMatch: '**/*.sim.mjs',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: {
    trace: 'retain-on-failure',
  },
  outputDir: './test-results/sim',
});
