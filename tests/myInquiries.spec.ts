import { test, expect } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config();

test('My Inquiries - data visibility check', async ({ page }) => {
  test.setTimeout(120000);
  let hasErrors = false;
  let errorSummary: string[] = [];

  console.log("🚀 Starting Sanity Run - My Inquiries");

  // שלב 1: התחברות (באמצעות הלוגיקה שעבדה לנו)
  await page.goto(`${process.env.BASE_URL}`);
  await page.click('button:has-text("כניסה"), a:has-text("כניסה")');
  await page.click('button[role="tab"]:has-text("באמצעות סיסמה")');
  await page.fill('input[name="tz"]', process.env.TEST_ID!);
  await page.fill('input[name="password"]', process.env.TEST_PASSWORD!);
  await page.locator('button[type="button"]:has-text("כניסה")').last().click();
  await page.waitForLoadState('networkidle');

  try {
    // שלב 2: מעבר לדף הפניות
    console.log("Navigating to My Inquiries...");
    await page.goto(`${process.env.BASE_URL}/my-inquiries/`);
    await page.waitForLoadState('networkidle');

    // שלב 3: זיהוי שקיימים נתונים ברשימה
    // אנחנו מחפשים את ה-span עם הקלאס 'sou' ששלחת, ומוודאים שיש לפחות אחד כזה עם תוכן
    console.log("Verifying that inquiries data is loaded...");
    const inquiryRecord = page.locator('span.sou').filter({ hasText: /./ }).first();
    
    // המתנה אקטיבית לטעינת הנתונים
    await expect(inquiryRecord).toBeVisible({ timeout: 20000 });
    
    const inquiryId = await inquiryRecord.innerText();
    console.log(`✅ Found inquiry record: ${inquiryId}`);

    // בדיקה נוספת - האם יש רשימה של פניות (בד"כ בתוך קוביות או טבלה)
    const listCount = await page.locator('span.sou').count();
    console.log(`✅ Total inquiries found on page: ${listCount}`);

    if (listCount === 0) {
      throw new Error("No inquiry records found on the page.");
    }

  } catch (e) {
    console.log("❌ Error in My Inquiries flow:", (e as Error).message);
    hasErrors = true;
    errorSummary.push("Inquiries Data Visibility");
  }

  if (hasErrors) {
    throw new Error(`My Inquiries test failed: ${errorSummary.join(', ')}`);
  } else {
    console.log("🎉 My Inquiries verification completed successfully!");
  }
});