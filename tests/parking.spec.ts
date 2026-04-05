import { test, expect } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config();

test('Parking - full flow', async ({ page }) => {
  test.setTimeout(150000);

  let hasErrors = false;
  let errorSummary: string[] = [];

  console.log("🚀 Starting Sanity Run - Parking");

  await page.goto(`${process.env.BASE_URL}/parking/?tab=1`);
  await page.click('button:has-text("התחברות"), a:has-text("התחברות")');
  await page.click('button[role="tab"]:has-text("באמצעות סיסמה")');
  await page.fill('input[name="tz"]', process.env.TEST_ID!);
  await page.fill('input[name="password"]', process.env.TEST_PASSWORD!);
  await page.locator('button[type="button"]:has-text("כניסה")').last().click();
  await page.waitForLoadState('networkidle');

  // --- 🛑 טיפול חכם בפופ-אפ "לתשומת ליבך" 🛑 ---
  console.log("🔍 Checking for informational popup...");
  try {
    const continueBtn = page.locator('button:has-text("המשך")').first();
    await continueBtn.waitFor({ state: 'visible', timeout: 5000 });
    await continueBtn.click();
    console.log("✅ Popup dismissed successfully.");
    await page.waitForLoadState('networkidle');
  } catch (e) {
    console.log("ℹ️ No popup appeared, continuing with the test.");
  }
  // ----------------------------------------------

  try {
    console.log("Checking tab: Unpaid Tickets...");
    await page.goto(`${process.env.BASE_URL}/parking/?tab=1#/parking/unpaid`);
    await page.waitForLoadState('networkidle');

    const ticketItem = page.locator('div[role="button"].toggle-list-item').first();
    await expect(ticketItem).toBeVisible({ timeout: 15000 });
    await ticketItem.click();

    const priceTag = page.locator('span.sou').filter({ hasText: '₪' }).first();
    await expect(priceTag).toBeVisible({ timeout: 10000 });
    const originalAmountRaw = await priceTag.innerText();
    const originalAmount = originalAmountRaw.replace(/[^0-9.]/g, '').trim();
    console.log(`✅ Unpaid ticket found. Amount: ${originalAmount}`);

    const [paymentPage] = await Promise.all([
      page.context().waitForEvent('page'),
      page.locator('button:has-text("לתשלום")').first().click(),
    ]);

    await paymentPage.waitForLoadState('networkidle');
    await paymentPage.locator('button[aria-label="הצג סכום"]').click();
    
    const portalSumLabel = paymentPage.locator('label#sumResult');
    
    await expect(portalSumLabel).toContainText(originalAmount, { timeout: 20000 });

    const portalAmountRaw = await portalSumLabel.innerText();
    const portalAmount = portalAmountRaw.replace(/[^0-9.]/g, '').trim();

    if (parseFloat(portalAmount) !== parseFloat(originalAmount)) {
      throw new Error(`Price mismatch! Portal: ${portalAmount}, Site: ${originalAmount}`);
    }
    console.log(`✅ Payment portal sum matches: ${portalAmount}`);
    await paymentPage.close();

  } catch (e) {
    console.log("❌ Error in Unpaid Tickets flow:", (e as Error).message);
    hasErrors = true;
    errorSummary.push("Unpaid Tickets");
  }

  try {
    console.log("Checking Appeal functionality...");
    await expect(page.locator('button:has-text("להגשת ערעור")').first()).toBeVisible({ timeout: 10000 });
    console.log("✅ Appeal button is present.");
  } catch (e) {
    console.log("❌ Appeal button not found:", (e as Error).message);
    hasErrors = true;
    errorSummary.push("Appeal Button");
  }

  try {
    console.log("Checking tab: Paid Tickets...");
    await page.locator('button[role="tab"]:has-text("דוחות ששולמו")').click();
    await page.waitForLoadState('networkidle');

    const paidItem = page.locator('div[role="button"].toggle-list-item').first();
    await expect(paidItem).toBeVisible({ timeout: 15000 });
    await paidItem.click();

    await expect(page.locator('p.MuiTypography-body2').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('div.MuiCardMedia-root').first()).toBeAttached({ timeout: 10000 });
    
    console.log("✅ Paid tickets history and images verified.");
  } catch (e) {
    console.log("❌ Error in Paid Tickets tab:", (e as Error).message);
    hasErrors = true;
    errorSummary.push("Paid Tickets History");
  }

  if (hasErrors) {
    throw new Error(`Parking test failed in: ${errorSummary.join(', ')}`);
  } else {
    console.log("🎉 Parking Sanity completed successfully!");
  }
});