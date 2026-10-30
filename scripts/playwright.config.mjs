import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './smoke',
  timeout: 90_000,
  expect: { timeout: 45_000 },
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5586',
    viewport: { width: 1366, height: 768 },
    serviceWorkers: 'block',
    actionTimeout: 30_000,
    navigationTimeout: 45_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 5586 --strictPort',
    url: 'http://127.0.0.1:5586',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
