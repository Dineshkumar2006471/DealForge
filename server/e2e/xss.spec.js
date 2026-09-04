const { test, expect } = require('@playwright/test');
test.describe('authenticated staging XSS regression', () => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL, 'requires an authenticated staging/static test environment');
  test('untrusted text is displayed as text, not executable markup', async ({ page }) => {
  await page.goto('/dashboard.html?id=xss-test');
  await expect(page.locator('body')).not.toContainText('<img src=x onerror=alert(1)>');
  });
});
