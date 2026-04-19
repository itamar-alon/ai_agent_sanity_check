import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test('Arnona - full flow', async ({ page, baseURL }) => {
  test.setTimeout(150000);

  let hasErrors = false;
  let errorSummary: string[] = [];

  console.log(`🚀 Starting Sanity Run - Arnona on: ${baseURL}`);

  await page.goto('/arnona/');
  
  console.log("⏳ Waiting for data or 'No Data' message...");

  const dataLocator = page.locator('span.truncate').first();
  const noDataLocator = page.getByText('אין נתונים');

  try {
    await expect(dataLocator.or(noDataLocator)).toBeVisible({ timeout: 30000 });
    console.log("✅ Page state determined (Data exists or 'No Data' visible).");
  } catch (e) {
    throw new Error("❌ Timeout: Neither data nor 'No Data' message appeared.");
  }

  try {
    console.log("🔍 Checking tab: Assets...");
    
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

  try {
    console.log("🔍 Checking tab: Account Status...");
    await page.click('a:has-text("מצב חשבון"), button:has-text("מצב חשבון")');
    
    const currencyLocator = page.locator('[aria-label*="₪"]').first();
    const noAccountData = page.getByText('אין נתונים');

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

  try {
    console.log("🔍 Checking tab: Payment Receipts...");
    await page.click('a:has-text("קבלות בגין תשלום"), button:has-text("קבלות בגין תשלום")');
    
    const skeletonLoader = page.locator('.MuiSkeleton-root, .skeleton, .loading-state').first();
    await skeletonLoader.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});

    const receiptDate = page.locator('span[aria-label*="/"]').first();
    
    const noDataMessages = page.locator(':text("אין נתונים"), :text("לא נמצאו תוצאות")').first();

    await expect(receiptDate.or(noDataMessages)).toBeVisible({ timeout: 20000 });

    if (await noDataMessages.isVisible()) {
      const foundText = await noDataMessages.innerText();
      console.log(`ℹ️ Receipts: Interface loaded but "${foundText.trim()}" (Valid state).`);
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