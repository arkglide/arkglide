import { test as base, expect } from "@playwright/test";

// Inspector tests import the exact already-loaded Babylon/Monaco module using
// Resource Timing. Vite's development module graph exceeds Chromium's default
// 250 records; installing this before navigation also covers page.reload().
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() =>
      performance.setResourceTimingBufferSize(4096),
    );
    await use(page);
  },
});
export { expect };
