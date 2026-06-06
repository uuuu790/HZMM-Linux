import { test, expect } from '@playwright/test';
import { launchHzmm, switchTab } from './helpers.mjs';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const VIEWPORT = { width: 1280, height: 800 };
// Visual regression threshold — allow 3% pixel diff for font rendering / anti-aliasing
const SCREENSHOT_OPTS = { maxDiffPixelRatio: 0.03 };

let app;
let page;

/**
 * Reset darkMode in config.json before launching so the app always starts
 * in a deterministic state (light mode). Prevents flaky diffs caused by
 * the dark-mode toggle persisting between Electron launches.
 */
function resetDarkModeConfig() {
  const configFile = join(process.env.APPDATA, 'hzmm-manager', 'config.json');
  if (!existsSync(configFile)) return;
  try {
    const config = JSON.parse(readFileSync(configFile, 'utf-8'));
    if (config.darkMode !== false) {
      config.darkMode = false;
      writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');
    }
  } catch { /* config doesn't exist or is corrupt — app will use defaults */ }
}

test.beforeAll(async () => {
  resetDarkModeConfig();
  ({ app, page } = await launchHzmm({ windowSize: VIEWPORT }));
  // Wait for initial render + async settings load to fully stabilize
  await page.waitForTimeout(1500);
});

test.afterAll(async () => {
  await app?.close();
});

// Helper: get current dark mode state.
// The 'dark' class lives on #root > div (App.jsx), NOT on <html>.
async function isDarkMode() {
  return page.evaluate(() =>
    document.querySelector('#root > div')?.classList.contains('dark') ?? false
  );
}

// Helper: toggle dark mode via settings
async function toggleDarkMode() {
  await switchTab(page, 'settings');
  const darkToggleBtn = page.locator('main button').filter({
    has: page.locator('svg.lucide-sun, svg.lucide-moon'),
  }).first();
  await darkToggleBtn.click();
  await page.waitForTimeout(500); // Wait for CSS transition
}

// Helper: ensure we're in light mode
async function ensureLightMode() {
  if (await isDarkMode()) {
    await toggleDarkMode();
  }
}

// Helper: ensure we're in dark mode
async function ensureDarkMode() {
  if (!(await isDarkMode())) {
    await toggleDarkMode();
  }
}

test.describe('Visual regression — Light mode', () => {
  test.beforeAll(async () => {
    await ensureLightMode();
  });

  test('dashboard light', async () => {
    await switchTab(page, 'dashboard');
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('dashboard-light.png', SCREENSHOT_OPTS);
  });

  test('modules light', async () => {
    await switchTab(page, 'modules');
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('modules-light.png', SCREENSHOT_OPTS);
  });

  test('profiles light', async () => {
    await switchTab(page, 'profiles');
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('profiles-light.png', SCREENSHOT_OPTS);
  });

  test('settings light', async () => {
    await switchTab(page, 'settings');
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('settings-light.png', SCREENSHOT_OPTS);
  });
});

test.describe('Visual regression — Dark mode', () => {
  test.beforeAll(async () => {
    await ensureDarkMode();
  });

  test('dashboard dark', async () => {
    await switchTab(page, 'dashboard');
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('dashboard-dark.png', SCREENSHOT_OPTS);
  });

  test('modules dark', async () => {
    await switchTab(page, 'modules');
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('modules-dark.png', SCREENSHOT_OPTS);
  });

  test('profiles dark', async () => {
    await switchTab(page, 'profiles');
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('profiles-dark.png', SCREENSHOT_OPTS);
  });

  test('settings dark', async () => {
    await switchTab(page, 'settings');
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('settings-dark.png', SCREENSHOT_OPTS);
  });
});

test.describe('Visual regression — restore original mode', () => {
  test('restore to light mode', async () => {
    await ensureLightMode();
    expect(await isDarkMode()).toBe(false);
  });
});
