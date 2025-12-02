import { test, expect } from '@playwright/test';

test('should load CK12 Flexi page', async ({ page }) => {
  // Go to the website
  await page.goto('https://www.ck12.org/flexi');
  
  // Wait for and verify the content
  await expect(page).toHaveTitle(/Flexi/);
  
  // Additional assertions can be added here
  const content = await page.content();
  expect(content).toContain('Flexi');
});
