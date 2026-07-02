import { test, expect } from '@playwright/test';
import { launchHzmm, switchTab } from './helpers.mjs';

let app;
let page;
const consoleErrors = [];

test.beforeAll(async () => {
  ({ app, page } = await launchHzmm());
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
});

test.afterAll(async () => {
  await app?.close();
});

test('Custom window controls render (Linux-only)', async () => {
  // src/main/index.js sets NEEDS_CUSTOM_CONTROLS = process.platform !== 'win32'
  // Three buttons: Minus (minimize), Square (maximize), X (close)
  const min = page.locator('button').filter({ has: page.locator('svg.lucide-minus') }).first();
  const max = page.locator('button').filter({ has: page.locator('svg.lucide-square') }).first();
  const close = page.locator('button').filter({ has: page.locator('svg.lucide-x') }).first();
  expect.soft(await min.isVisible(),  'Minimize button visible').toBe(true);
  expect.soft(await max.isVisible(),  'Maximize button visible').toBe(true);
  expect.soft(await close.isVisible(),'Close button visible').toBe(true);
});

test('Proton Launch Option copy button (Linux-only)', async () => {
  await switchTab(page, 'settings');
  await page.locator('html').evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  // The Proton block uses a Terminal icon + a ClipboardCopy icon button.
  // SettingsTab is lazy()-loaded, so wait for the button to attach instead of
  // sampling count() once (races the Suspense fallback).
  const copyBtn = page.locator('button').filter({ has: page.locator('svg.lucide-clipboard-copy') }).first();
  await expect(copyBtn, 'Proton copy button exists').toBeAttached({ timeout: 10_000 });
  const errBefore = consoleErrors.length;
  await copyBtn.scrollIntoViewIfNeeded();
  await copyBtn.click({ force: true });
  await page.waitForTimeout(400);
  const errAfter = consoleErrors.length;
  expect.soft(errAfter - errBefore, `console errors after copy: ${consoleErrors.slice(errBefore).join(' | ')}`).toBe(0);
});
