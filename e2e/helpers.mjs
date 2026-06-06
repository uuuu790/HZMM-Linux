import { _electron as electron } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Launches HZMM and waits for the main UI to be ready.
 * Returns { app, page } — call app.close() in afterAll.
 */
export async function launchHzmm({ windowSize } = {}) {
  const env = { ...process.env };
  // Pass window size hint via env so main process can use it
  if (windowSize) {
    env.HZMM_TEST_WIDTH = String(windowSize.width);
    env.HZMM_TEST_HEIGHT = String(windowSize.height);
  }
  const app = await electron.launch({
    args: [resolve(__dirname, '../out/main/index.js')],
    timeout: 20_000,
    env,
  });
  const page = await app.firstWindow();
  if (windowSize) {
    await page.setViewportSize(windowSize);
  }
  await page.waitForLoadState('domcontentloaded');
  // Sidebar radio inputs are visually hidden — wait for attached
  await page.waitForSelector('#tab-dashboard', { state: 'attached', timeout: 15_000 });
  await page.waitForSelector('label[for="tab-dashboard"]', { state: 'visible', timeout: 15_000 });
  return { app, page };
}

/** Switch to a sidebar tab by id ('dashboard' | 'modules' | 'profiles' | 'settings'). */
export async function switchTab(page, tab) {
  await page.locator(`label[for="tab-${tab}"]`).click();
  await page.waitForFunction(
    (t) => document.querySelector(`#tab-${t}`)?.checked === true,
    tab,
    { timeout: 5_000 }
  );
}

/**
 * Close any open modal by clicking its backdrop or X button.
 * HZMM modals don't handle the Escape key — they rely on backdrop click or X.
 */
export async function closeModalWithEscape(page) {
  const modal = page.locator('div.fixed.inset-0.z-\\[100\\]');
  if ((await modal.count()) === 0) return; // no modal open
  // Prefer the X button in the modal header
  const xButton = modal.locator('button').filter({ has: page.locator('svg.lucide-x') }).first();
  if ((await xButton.count()) > 0) {
    await xButton.click({ force: true });
  } else {
    // Fall back to clicking the backdrop
    await modal.locator('div.absolute.inset-0').first().click({ position: { x: 5, y: 5 } });
  }
  // Wait for modal to unmount
  await page.waitForSelector('div.fixed.inset-0.z-\\[100\\]', { state: 'detached', timeout: 3000 }).catch(() => {});
}
