import { test, expect } from '@playwright/test';
import { launchHzmm, switchTab, closeModalWithEscape } from './helpers.mjs';

const TABS = ['dashboard', 'modules', 'nexus', 'profiles', 'settings'];
const consoleErrors = [];
const pageErrors = [];

let app;
let page;

test.beforeAll(async () => {
  ({ app, page } = await launchHzmm());
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
});

test.afterAll(async () => {
  await app?.close();
});

test.describe('Sidebar tab switching', () => {
  for (const tab of TABS) {
    test(`switch to ${tab}`, async () => {
      await switchTab(page, tab);
      const radio = page.locator(`#tab-${tab}`);
      await expect(radio).toBeChecked();
      await page.screenshot({ path: `e2e/__screenshots__/_smoke-tab-${tab}.png`, fullPage: false });
    });
  }
});

test.describe('Settings tab buttons (no side effects)', () => {
  test.beforeAll(async () => {
    await switchTab(page, 'settings');
  });

  test('Detect game path button responds (no console error)', async () => {
    const errBefore = consoleErrors.length;
    const detectBtn = page.locator('button').filter({ has: page.locator('svg.lucide-refresh-cw') }).first();
    await expect(detectBtn).toBeVisible();
    await detectBtn.click({ force: true });
    await page.waitForTimeout(1500);
    const errAfter = consoleErrors.length;
    expect.soft(errAfter - errBefore, `console errors after Detect Path: ${consoleErrors.slice(errBefore).join(' | ')}`).toBe(0);
  });

  test('Conflict scan button triggers handler', async () => {
    const errBefore = consoleErrors.length;
    const conflictBtn = page.locator('button').filter({ has: page.locator('svg.lucide-triangle-alert, svg.lucide-alert-triangle') }).first();
    await expect(conflictBtn).toBeVisible();
    await conflictBtn.click({ force: true });
    await page.waitForTimeout(1500);
    const errAfter = consoleErrors.length;
    expect.soft(errAfter - errBefore, `console errors after Conflict Scan: ${consoleErrors.slice(errBefore).join(' | ')}`).toBe(0);
    await closeModalWithEscape(page);
  });

  test('View Logs button opens log modal', async () => {
    const errBefore = consoleErrors.length;
    const logsBtn = page.locator('button').filter({ has: page.locator('svg.lucide-file-text') }).first();
    await expect(logsBtn).toBeVisible();
    await logsBtn.click({ force: true });
    await page.waitForTimeout(1000);
    const modal = page.locator('div.fixed.inset-0.z-\\[100\\]').first();
    const modalOpened = (await modal.count()) > 0;
    expect.soft(modalOpened, 'Logs modal should open after View Logs click').toBe(true);
    if (modalOpened) await closeModalWithEscape(page);
    const errAfter = consoleErrors.length;
    expect.soft(errAfter - errBefore, `console errors after View Logs: ${consoleErrors.slice(errBefore).join(' | ')}`).toBe(0);
  });

  test('Update system functional (button or status indicator present)', async () => {
    const pageErrBefore = pageErrors.length;
    // App auto-runs update check at startup. By this point state machine may already
    // be at 'latest' / 'available' / 'downloading' / 'ready' — any of those is success.
    const updateBtn = page.getByRole('button', { name: /check for updates|檢查更新|nach updates suchen/i }).first();
    const latestText = page.getByText(/up to date|latest|最新|目前最新/i).first();
    const availableBtn = page.getByRole('button', { name: /download|下載/i }).first();
    const btnExists = (await updateBtn.count()) > 0;
    const latestExists = await latestText.isVisible().catch(() => false);
    const availableExists = (await availableBtn.count()) > 0 && await availableBtn.isVisible().catch(() => false);
    if (btnExists) {
      await updateBtn.click({ force: true });
      await page.waitForTimeout(2500);
    }
    expect.soft(btnExists || latestExists || availableExists, 'Update system should expose either Check button or a resolved status').toBe(true);
    const pageErrAfter = pageErrors.length;
    expect.soft(pageErrAfter - pageErrBefore, `page errors during Update check: ${pageErrors.slice(pageErrBefore).join(' | ')}`).toBe(0);
  });

  test('Dark mode toggle round-trip', async () => {
    const errBefore = consoleErrors.length;
    const html = page.locator('html');
    const wasDark = (await html.getAttribute('class') || '').includes('dark');
    // Find toggle: button with sun or moon icon at the top of Settings
    const toggleBtn = page.locator('button').filter({ has: page.locator('svg.lucide-sun, svg.lucide-moon') }).first();
    await expect(toggleBtn).toBeVisible();
    await toggleBtn.click({ force: true });
    await page.waitForTimeout(400);
    const nowDark = (await html.getAttribute('class') || '').includes('dark');
    expect.soft(nowDark, 'Dark mode should toggle').toBe(!wasDark);
    // Restore
    await toggleBtn.click({ force: true });
    await page.waitForTimeout(400);
    const finalDark = (await html.getAttribute('class') || '').includes('dark');
    expect.soft(finalDark, 'Dark mode should restore').toBe(wasDark);
    const errAfter = consoleErrors.length;
    expect.soft(errAfter - errBefore, `console errors after Dark toggle: ${consoleErrors.slice(errBefore).join(' | ')}`).toBe(0);
  });
});

test.describe('Header buttons', () => {
  test('Language dropdown opens and shows items', async () => {
    await switchTab(page, 'dashboard');
    const errBefore = consoleErrors.length;
    const langBtn = page.locator('button').filter({ has: page.locator('svg.lucide-globe') }).first();
    await expect(langBtn).toBeVisible();
    await langBtn.click({ force: true });
    await page.waitForTimeout(400);
    // Dropdown should list locale items — look for a known locale string ('English' is always present)
    const enItem = page.locator('text=English').first();
    const visible = await enItem.isVisible().catch(() => false);
    expect.soft(visible, 'Language dropdown should expose English option').toBe(true);
    // Click somewhere neutral to close dropdown
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    const errAfter = consoleErrors.length;
    expect.soft(errAfter - errBefore, `console errors after Language dropdown: ${consoleErrors.slice(errBefore).join(' | ')}`).toBe(0);
  });
});

test.afterAll(() => {
  if (consoleErrors.length || pageErrors.length) {
    console.log('\n=== Smoke session summary ===');
    console.log(`Console errors: ${consoleErrors.length}`);
    consoleErrors.forEach((e, i) => console.log(`  [${i}] ${e}`));
    console.log(`Page errors: ${pageErrors.length}`);
    pageErrors.forEach((e, i) => console.log(`  [${i}] ${e}`));
  }
});
