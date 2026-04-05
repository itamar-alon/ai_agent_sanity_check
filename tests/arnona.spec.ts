import { test, expect } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
dotenv.config();

test('Arnona - full flow', async ({ page }) => {
  test.setTimeout(150000); // הגדלתי מעט את הטיימאאוט הכללי של הטסט

  let hasErrors = false;
  let errorSummary: string[] = [];

  console.log("🚀 Starting Sanity Run - Arnona");

  await page.goto(`${process.env.BASE_URL}/arnona/`);
  await page.click('button:has-text("התחברות"), a:has-text("התחברות")');
  await page.click('button[role="tab"]:has-text("באמצעות סיסמה")');
  await page.fill('input[name="tz"]', process.env.TEST_ID!);
  await page.fill('input[name="password"]', process.env.TEST_PASSWORD!);
  await page.locator('button[type="button"]:has-text("כניסה")').last().click();
  await page.waitForLoadState('networkidle');

  try {
    console.log("Checking tab: Assets...");
    const assetsElement = page.locator('span.truncate').first();
    await expect(assetsElement).toBeVisible({ timeout: 10000 });
    const content = await assetsElement.innerText();
    if (content.includes("אין נתונים") || content.trim() === "") {
      throw new Error("Assets tab shows no data");
    }
  } catch (e) {
    console.log("❌ Error in Assets tab:", (e as Error).message);
    hasErrors = true;
    errorSummary.push("Assets");
  }

  try {
    console.log("Checking tab: Account Status...");
    await page.click('a:has-text("מצב חשבון"), button:has-text("מצב חשבון")');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[aria-label*="₪"]').first()).toBeVisible({ timeout: 10000 });
  } catch (e) {
    console.log("❌ Error in Account Status tab:", (e as Error).message);
    hasErrors = true;
    errorSummary.push("Account Status");
  }

  try {
    console.log("Checking tab: View Vouchers...");
    await page.click('a:has-text("צפיה בשוברים"), button:has-text("צפיה בשוברים")');
    await page.waitForLoadState('networkidle');
    
    await expect(page.locator('.MuiSelect-select').nth(0)).toBeVisible({ timeout: 10000 });
    await page.locator('.MuiSelect-select').nth(0).click();
    await page.locator('[role="option"]').nth(1).click();
    await page.waitForLoadState('networkidle');

    try {
      await expect(page.locator('.MuiSelect-select').nth(1)).toBeVisible({ timeout: 3000 });
      await page.locator('.MuiSelect-select').nth(1).click();
      await page.locator('[role="option"]').nth(1).click();
      await page.waitForLoadState('networkidle');
    } catch (e) {}

    await page.waitForSelector('span[aria-label="צפייה"]', { state: 'visible', timeout: 15000 });

    // התיקון כאן: שימוש ב-Promise.all והגדלת ה-Timeout ל-60 שניות
    console.log("Initiating voucher download (waiting up to 60s)...");
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }), 
      page.locator('span[aria-label="צפייה"]').first().click(),
    ]);
    
    const filePath = path.join(__dirname, download.suggestedFilename());
    await download.saveAs(filePath);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log("✅ Voucher downloaded and deleted successfully.");
    }
  } catch (e) {
    console.log("❌ Error in View Vouchers tab:", (e as Error).message);
    hasErrors = true;
    errorSummary.push("Vouchers");
  }

  try {
    console.log("Checking tab: Payment Receipts...");
    await page.click('a:has-text("קבלות בגין תשלום"), button:has-text("קבלות בגין תשלום")');
    await page.waitForLoadState('networkidle');
    
    const receiptDate = page.locator('span[aria-label*="/"]').first();
    await expect(receiptDate).toBeVisible({ timeout: 15000 });
    console.log("✅ Receipts data found successfully.");
  } catch (e) {
    console.log("❌ Error in Payment Receipts tab:", (e as Error).message);
    hasErrors = true;
    errorSummary.push("Receipts");
  }

  if (hasErrors) {
    throw new Error(`Test failed in the following tabs: ${errorSummary.join(', ')}`);
  } else {
    console.log("🎉 All tabs verified successfully!");
  }
});