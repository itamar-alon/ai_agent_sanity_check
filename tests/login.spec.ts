import { test, expect } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config();

test.describe('Login', () => {

  test('successful login with valid credentials', async ({ page }) => {
    await page.goto(process.env.BASE_URL!);

    // Click the login button to open the modal
    await page.click('button:has-text("כניסה")');

    // Click "באמצעות סיסמה" tab
    await page.click('button[role="tab"]:has-text("באמצעות סיסמה")');

    // Fill ID and password
    await page.fill('input[name="tz"]', process.env.TEST_ID!);
    await page.fill('input[name="password"]', process.env.TEST_PASSWORD!);

    // Click the submit button inside the modal
    await page.locator('button[type="button"]:has-text("כניסה")').last().click();

    // Should be logged in
    await expect(page).not.toHaveURL(/login/);
  });

  test('failed login with wrong password', async ({ page }) => {
    await page.goto(process.env.BASE_URL!);

    await page.click('button:has-text("כניסה")');
    await page.click('button[role="tab"]:has-text("באמצעות סיסמה")');

    await page.fill('input[name="tz"]', process.env.TEST_ID!);
    await page.fill('input[name="password"]', 'wrong_password_123');

    await page.locator('button[type="button"]:has-text("כניסה")').last().click();

    // Should show an error message
    await expect(page.locator('.MuiAlert-message')).toBeVisible();
});

});
