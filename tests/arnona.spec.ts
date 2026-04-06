import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test('Arnona - full flow', async ({ page, baseURL }) => {
  test.setTimeout(150000);

  let hasErrors = false;
  let errorSummary: string[] = [];

  console.log(`🚀 Starting Sanity Run - Arnona on: ${baseURL}`);

  // 1. ניווט לעמוד הארנונה
  await page.goto('/arnona/');
  
  console.log("⏳ Waiting for data or 'No Data' message...");

  // הגדרת שני הלוקטורים האפשריים
  const dataLocator = page.locator('span.truncate').first();
  const noDataLocator = page.getByText('אין נתונים');

  try {
    // ממתינים עד שאחד מהם יופיע (משתמשים ב-or)
    await expect(dataLocator.or(noDataLocator)).toBeVisible({ timeout: 30000 });
    console.log("✅ Page state determined (Data exists or 'No Data' visible).");
  } catch (e) {
    throw new Error("❌ Timeout: Neither data nor 'No Data' message appeared.");
  }

  // --- בדיקה 1: טאב נכסים ---
  try {
    console.log("🔍 Checking tab: Assets...");
    
    // בודקים מה מופיע כרגע
    if (await noDataLocator.isVisible()) {
      console.log("ℹ️ Assets: No data found for this user (Valid state).");
    } else {
      const content = await dataLocator.innerText();
      if (content.trim() === "") {
        throw new Error("Assets tab is empty but 'No Data' message is missing");
      }
      console.log("✅ Assets tab verified with data.");
    }
  } catch (e) {
    console.error("❌ Error in Assets tab:", (e as Error).message);
    hasErrors = true;
    errorSummary.push("Assets");
  }

  // --- בדיקה 2: טאב מצב חשבון ---
  try {
    console.log("🔍 Checking tab: Account Status...");
    await page.click('a:has-text("מצב חשבון"), button:has-text("מצב חשבון")');
    
    const currencyLocator = page.locator('[aria-label*="₪"]').first();
    const noAccountData = page.getByText('אין נתונים');

    // מחכים לאחד משניהם
    await expect(currencyLocator.or(noAccountData)).toBeVisible({ timeout: 20000 });

    if (await noAccountData.isVisible()) {
      console.log("ℹ️ Account Status: No financial data found (Valid state).");
    } else {
      console.log("✅ Account Status verified with financial data.");
    }
  } catch (e) {
    console.error("❌ Error in Account Status tab:", (e as Error).message);
    hasErrors = true;
    errorSummary.push("Account Status");
  }

  // --- בדיקה 3: צפייה בשוברים ---
  try {
    console.log("🔍 Checking tab: View Vouchers...");
    await page.click('a:has-text("צפיה בשוברים"), button:has-text("צפיה בשוברים")');
    
    const voucherSelect = page.locator('.MuiSelect-select').nth(0);
    const noVouchers = page.getByText('אין נתונים');

    await expect(voucherSelect.or(noVouchers)).toBeVisible({ timeout: 20000 });

    if (await noVouchers.isVisible()) {
      console.log("ℹ️ Vouchers: No vouchers to display (Valid state).");
    } else {
      await voucherSelect.click();
      await page.locator('[role="option"]').nth(1).click();

      const viewButton = page.locator('span[aria-label="צפייה"]').first();
      await viewButton.waitFor({ state: 'visible', timeout: 15000 });

      console.log("⏳ Attempting to view/download voucher...");
      const [download, newPage] = await Promise.allSettled([
        page.waitForEvent('download', { timeout: 15000 }),
        page.context().waitForEvent('page', { timeout: 15000 }),
        viewButton.click(),
      ]);

      if (download.status === 'fulfilled' || newPage.status === 'fulfilled') {
        console.log("✅ Voucher detected and verified.");
        if (newPage.status === 'fulfilled') await newPage.value.close();
      } else {
        console.log("⚠️ Could not trigger download/tab, but voucher button exists.");
      }
    }
  } catch (e) {
    console.error("❌ Error in View Vouchers tab:", (e as Error).message);
    hasErrors = true;
    errorSummary.push("Vouchers");
  }

  // --- בדיקה 4: קבלות בגין תשלום ---
  try {
    console.log("🔍 Checking tab: Payment Receipts...");
    await page.click('a:has-text("קבלות בגין תשלום"), button:has-text("קבלות בגין תשלום")');
    
    const receiptDate = page.locator('span[aria-label*="/"]').first();
    const noReceipts = page.getByText('אין נתונים');

    await expect(receiptDate.or(noReceipts)).toBeVisible({ timeout: 20000 });

    if (await noReceipts.isVisible()) {
      console.log("ℹ️ Receipts: No payment receipts found (Valid state).");
    } else {
      console.log("✅ Receipts data verified.");
    }
  } catch (e) {
    console.error("❌ Error in Payment Receipts tab:", (e as Error).message);
    hasErrors = true;
    errorSummary.push("Receipts");
  }

  if (hasErrors) {
    throw new Error(`Arnona Test Failed in: ${errorSummary.join(', ')}`);
  } else {
    console.log("🎉 All Arnona tabs verified successfully!");
  }
});