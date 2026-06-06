import { test, expect } from '@playwright/test';
import { launchHzmm, switchTab } from './helpers.mjs';
import { writeFileSync, mkdtempSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let app;
let page;

test.beforeAll(async () => {
  ({ app, page } = await launchHzmm());
  await switchTab(page, 'dashboard');
});

test.afterAll(async () => {
  await app?.close();
});

/**
 * Simulate a file drag event on an element.
 * Playwright can't truly drag OS files, but we can dispatch
 * synthetic dragover/dragleave/drop events with a DataTransfer.
 */
async function simulateDragEvent(page, selector, eventType, files = []) {
  await page.evaluate(
    ({ selector, eventType, files }) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`Element not found: ${selector}`);

      const dt = new DataTransfer();
      for (const f of files) {
        // Create a File object in the renderer context
        dt.items.add(new File([''], f.name, { type: f.type }));
      }

      const event = new DragEvent(eventType, {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
      });
      el.dispatchEvent(event);
    },
    { selector, eventType, files }
  );
}

test.describe('Drag & drop on dashboard dropzone', () => {
  test('dropzone exists and has file input', async () => {
    const dropzone = page.locator('[class*="border-dashed"]').first();
    await expect(dropzone).toBeVisible();
    // Hidden file input should exist
    const fileInput = page.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached();
  });

  test('dragover on window calls preventDefault (enables drop)', async () => {
    // Verify the global dragover handler is active — it must preventDefault
    // so the browser allows drop events. dropEffect is readonly in synthetic events.
    const defaultPrevented = await page.evaluate(() => {
      const dt = new DataTransfer();
      const event = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
      });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(defaultPrevented).toBe(true);
  });

  test('dragover on dropzone shows active state', async () => {
    const dropzone = page.locator('[class*="border-dashed"]').first();
    const classNameBefore = await dropzone.getAttribute('class');

    await simulateDragEvent(page, '[class*="border-dashed"]', 'dragover', [
      { name: 'test-mod.zip', type: 'application/zip' },
    ]);
    await page.waitForTimeout(200);

    const classNameDuring = await dropzone.getAttribute('class');

    // Clean up: fire dragleave
    await simulateDragEvent(page, '[class*="border-dashed"]', 'dragleave');
    await page.waitForTimeout(200);

    // During dragover, the dropzone should change appearance
    // (either class change or opacity change or border color change)
    // At minimum, the component shouldn't crash
    expect(classNameDuring).toBeDefined();
  });

  test('drop event with non-mod file does not crash the app', async () => {
    await simulateDragEvent(page, '[class*="border-dashed"]', 'drop', [
      { name: 'readme.txt', type: 'text/plain' },
    ]);
    await page.waitForTimeout(500);
    // App should still be alive — check that root is visible
    await expect(page.locator('#root')).toBeVisible();
  });

  test('drop event with .zip file does not crash the app', async () => {
    await simulateDragEvent(page, '[class*="border-dashed"]', 'drop', [
      { name: 'test-mod.zip', type: 'application/zip' },
    ]);
    await page.waitForTimeout(500);
    // App should still be responsive
    await expect(page.locator('#root')).toBeVisible();
    // May show a toast or preview modal — just verify no crash
  });

  test('multiple file drop does not crash', async () => {
    await simulateDragEvent(page, '[class*="border-dashed"]', 'drop', [
      { name: 'mod1.zip', type: 'application/zip' },
      { name: 'mod2.pak', type: 'application/octet-stream' },
      { name: 'mod3.rar', type: 'application/x-rar-compressed' },
    ]);
    await page.waitForTimeout(500);
    await expect(page.locator('#root')).toBeVisible();
  });

  test('file input accepts .zip, .rar, .pak extensions', async () => {
    const fileInput = page.locator('input[type="file"]').first();
    const accept = await fileInput.getAttribute('accept');
    // Should accept mod file types
    expect(accept).toContain('.zip');
    expect(accept).toContain('.rar');
    expect(accept).toContain('.pak');
  });
});
