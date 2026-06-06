import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Electron apps don't parallelize — share one instance per file
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01, // Allow 1% pixel diff for anti-aliasing
    },
  },
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  snapshotDir: './e2e/__screenshots__',
});
