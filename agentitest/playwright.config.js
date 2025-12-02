// @ts-check
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test_packages',
  use: {
    headless: false,
    viewport: { width: 1280, height: 720 },
    video: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  reporter: 'html',
});