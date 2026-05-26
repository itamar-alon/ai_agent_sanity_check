import { test, expect } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config();

test.describe('Login', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('successful login with valid credentials', async ({ page }) => {
    await page.goto(process.env.BASE_URL!);
    
    try {
      const cookieBtn = page.locator('button:has-text("מאשר הכל")');
      if (await cookieBtn.isVisible({ timeout: 3000 })) {
        await cookieBtn.click();
      }
    } catch(e) {}

    await page.click('button:has-text("כניסה")');
    await page.click('button[role="tab"]:has-text("באמצעות סיסמה")');
    await page.fill('input[name="tz"]', process.env.TEST_ID!);
    await page.fill('input[name="password"]', process.env.TEST_PASSWORD!);
    
    await page.locator('button[type="button"]:has-text("כניסה")').last().click({ force: true });
    
    await expect(page).not.toHaveURL(/login/, { timeout: 15000 });
  });

  test('failed login with wrong password', async ({ page }) => {
    await page.goto(process.env.BASE_URL!);
    
    try {
      const cookieBtn = page.locator('button:has-text("מאשר הכל")');
      if (await cookieBtn.isVisible({ timeout: 3000 })) {
        await cookieBtn.click();
      }
    } catch(e) {}

    await page.click('button:has-text("כניסה")');
    await page.click('button[role="tab"]:has-text("באמצעות סיסמה")');
    await page.fill('input[name="tz"]', process.env.TEST_ID!);
    await page.fill('input[name="password"]', 'wrong_password_123');
    await page.locator('button[type="button"]:has-text("כניסה")').last().click({ force: true });
    
    const errorMsg = page.getByText(/אחד מהפרטים.*אינו מזוהה במערכת/);
    await expect(errorMsg).toBeVisible({ timeout: 10000 });
  });
});