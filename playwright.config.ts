import { defineConfig } from "@playwright/test";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
export default defineConfig({
  // Keep worker/browser isolation identical for CI and custom local Chromium.
  projects: [
    { name: "editor", testMatch: "**/editor.spec.ts" },
    { name: "batch1", testMatch: "**/batch1.spec.ts" },
    { name: "batch2", testMatch: "**/batch2.spec.ts" },
    { name: "batch2-complete", testMatch: "**/batch2-complete.spec.ts" },
    { name: "batch3", testMatch: "**/batch3.spec.ts" },
    { name: "modules", testMatch: "**/modules.spec.ts" },
    { name: "third-full", testMatch: "**/third-full.spec.ts" },
  ],
  reporter: [["list"], ["html", { open: "never" }]],
  testDir: "./tests/browser",
  timeout: 120000,
  workers: 1,
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    baseURL: "http://127.0.0.1:5196",
    viewport: { width: 1440, height: 1000 },
    launchOptions: executablePath
      ? {
          executablePath,
          args: [
            "--no-sandbox",
            "--no-zygote",
            "--single-process",
            "--in-process-gpu",
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
          ],
        }
      : {
          args: [
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
          ],
        },
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5196",
    url: "http://127.0.0.1:5196",
    timeout: 120000,
    reuseExistingServer: false,
  },
});
