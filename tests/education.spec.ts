import { test, expect } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config();

test('Education - full flow', async ({ page }) => {
  test.setTimeout(150000);

  let hasErrors = false;
  let errorSummary: string[] = [];

  console.log("🚀 Starting Sanity Run - Education");

  await page.goto(`${process.env.BASE_URL}/education/?tab=1`);
  await page.click('button:has-text("התחברות"), a:has-text("התחברות")');
  await page.click('button[role="tab"]:has-text("באמצעות סיסמה")');
  await page.fill('input[name="tz"]', process.env.TEST_ID!);
  await page.fill('input[name="password"]', process.env.TEST_PASSWORD!);
  await page.locator('button[type="button"]:has-text("כניסה")').last().click();
  await page.waitForLoadState('networkidle');

  // --- 🛑 טיפול חכם בפופ-אפ "לתשומת ליבך" 🛑 ---
  console.log("🔍 Checking for informational popup...");
  try {
    // נחפש את כפתור "המשך" וניתן לו 5 שניות להופיע
    const continueBtn = page.locator('button:has-text("המשך")').first();
    await continueBtn.waitFor({ state: 'visible', timeout: 5000 });
    await continueBtn.click();
    console.log("✅ Popup dismissed successfully.");
    await page.waitForLoadState('networkidle');
  } catch (e) {
    // השגיאה נבלעת בכוונה. אם לא קפץ פופ-אפ, הכל בסדר, פשוט ממשיכים.
    console.log("ℹ️ No popup appeared, continuing with the test.");
  }
  // ----------------------------------------------

  try {
    console.log("Checking tab: Student Payments...");
    await page.goto(`${process.env.BASE_URL}/education/?tab=1#/students/payments`);
    await page.waitForLoadState('networkidle');

    const paymentLink = page.locator('span[aria-label*="₪"]').first();
    await expect(paymentLink).toBeVisible({ timeout: 15000 });
    const amountText = await paymentLink.getAttribute('aria-label');
    console.log(`✅ Payment data found: ${amountText}`);

    const [externalPage] = await Promise.all([
      page.context().waitForEvent('page'),
      paymentLink.click(),
    ]);

    await externalPage.waitForLoadState('networkidle');
    const accountInput = externalPage.locator('#MisparHeshbon');
    await expect(accountInput).toBeVisible({ timeout: 15000 });
    await expect(accountInput).not.toHaveValue('', { timeout: 10000 });
    
    console.log("✅ External payment portal verified with account data.");
    await externalPage.close();
  } catch (e) {
    console.log("❌ Error in Student Payments flow:", (e as Error).message);
    hasErrors = true;
    errorSummary.push("Student Payments");
  }

  try {
    console.log("Checking tab: Additional Payments...");
    await page.click('button[role="tab"]:has-text("תשלומים נוספים")');
    await page.waitForLoadState('networkidle');

    const totalBalanceLink = page.locator('a[aria-label*="יתרות"]').first();
    await expect(totalBalanceLink).toBeVisible({ timeout: 15000 });
    const balanceAmount = await totalBalanceLink.getAttribute('aria-label');
    console.log(`✅ Additional payments found: ${balanceAmount}`);

    const [balancePage] = await Promise.all([
      page.context().waitForEvent('page'),
      totalBalanceLink.click(),
    ]);

    await balancePage.waitForLoadState('networkidle');
    const balanceAccountInput = balancePage.locator('#MisparHeshbon');
    await expect(balanceAccountInput).toBeVisible({ timeout: 15000 });
    await expect(balanceAccountInput).not.toHaveValue('', { timeout: 10000 });

    console.log("✅ External balance portal verified.");
    await balancePage.close();
  } catch (e) {
    console.log("❌ Error in Additional Payments flow:", (e as Error).message);
    hasErrors = true;
    errorSummary.push("Additional Payments");
  }

  try {
    console.log("Checking tab: Registration and Placement...");
    await page.click('button[role="tab"]:has-text("רישום/שיבוץ")');
    await page.waitForLoadState('networkidle');

    const registrationData = page.locator('span[aria-label^="0000"]').first();
    await expect(registrationData).toBeVisible({ timeout: 15000 });
    const regValue = await registrationData.getAttribute('aria-label');
    console.log(`✅ Registration data found: ${regValue}`);
  } catch (e) {
    console.log("❌ Error in Registration tab:", (e as Error).message);
    hasErrors = true;
    errorSummary.push("Registration/Placement");
  }

  if (hasErrors) {
    throw new Error(`Education test failed in: ${errorSummary.join(', ')}`);
  } else {
    console.log("🎉 Education Sanity completed successfully!");
  }
});