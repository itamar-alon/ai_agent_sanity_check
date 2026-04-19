import { test, expect } from '@playwright/test';

test('My Inquiries - data visibility check', async ({ page, baseURL }) => {
  test.setTimeout(120000);
  let hasErrors = false;
  let errorSummary: string[] = [];

  console.log(`🚀 Starting Sanity Run - My Inquiries on: ${baseURL}`);


  await page.goto('/');

  const cookieBtn = page.getByRole('button', { name: 'מאשר הכל' });
  if (await cookieBtn.isVisible({ timeout: 5000 })) {
    await cookieBtn.click();
    await cookieBtn.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    console.log("✅ Cookie banner cleared.");
  }

  const globalContinueBtn = page.getByRole('button', { name: 'המשך' }).first();
  if (await globalContinueBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await globalContinueBtn.click({ force: true });
    console.log("✅ Initial informational popup cleared.");
  }

  try {
    console.log("Navigating to My Inquiries via UI...");
    

    const inquiriesTile = page.getByText(/פניותיי|הפניות שלי|מעקב פניות/).first();
    await inquiriesTile.click();
    
    console.log("Verifying that inquiries data is loaded...");
    
    const noDataLocator = page.getByText(/אין נתונים|לא נמצאו פניות/).first();
    
    const inquiryRecord = page.locator('span.sou').filter({ hasText: /./ }).first();
    
    await expect(inquiryRecord.or(noDataLocator)).toBeVisible({ timeout: 20000 });
    
    if (await noDataLocator.isVisible()) {
        console.log("ℹ️ No inquiry records found for this test user (Empty state verified).");
    } else {
        const inquiryId = await inquiryRecord.innerText();
        console.log(`✅ Found inquiry record: ${inquiryId}`);

        const listCount = await page.locator('span.sou').count();
        console.log(`✅ Total inquiries found on page: ${listCount}`);
    }

  } catch (e) {
    console.error("❌ Error in My Inquiries flow:", (e as Error).message);
    hasErrors = true;
    errorSummary.push("Inquiries Data Visibility");
  }

  if (hasErrors) {
    throw new Error(`My Inquiries test failed: ${errorSummary.join(', ')}`);
  } else {
    console.log("🎉 My Inquiries verification completed successfully!");
  }
});