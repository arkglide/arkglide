import { defineConfig } from '@playwright/test';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
export default defineConfig({
  testDir: './tests/browser', timeout: 120000, workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5196', viewport: { width: 1440, height: 1000 },
    launchOptions: executablePath ? { executablePath, args: ['--no-sandbox','--no-zygote','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] } : { args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] },
  },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5196', url: 'http://127.0.0.1:5196', timeout: 120000, reuseExistingServer: false },
});
