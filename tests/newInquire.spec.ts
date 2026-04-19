import { test, expect } from '@playwright/test';

const INQUIRY_MOCK_RESPONSE = {
  Status: "200",
  Message: "Success פניה נשלחה בהצלחה",
  Id: "CAL-2603-00029"
};

const inquiryTypes = [
  { name: 'Field Treatment (106)', buttonText: 'נדרש טיפול מיידי בשטח', is106: true },
  { name: 'Information Request', buttonText: 'בירור או בקשת מידע', is106: false }
];

test('Create All Inquiries - Single Session with Reset Logic', async ({ page, baseURL }) => {
  test.setTimeout(240000);
  let hasErrors = false;
  let errorSummary: string[] = [];

  console.log(`🚀 Starting Integrated Sanity Run - New Inquiries on: ${baseURL}`);

  await page.route('**/Umbraco/Api/NewCallApi/SendNewCall*', async route => {
    console.log(`🛡️ MOCK ACTIVATED: Intercepting submission`);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(INQUIRY_MOCK_RESPONSE)
    });
  });

  for (const type of inquiryTypes) {
    console.log(`\n--- Processing: ${type.name} ---`);
    
    try {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      const cookieBtn = page.getByRole('button', { name: 'מאשר הכל' });
      if (await cookieBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await cookieBtn.click();
        await cookieBtn.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
      }

      const globalContinueBtn = page.getByRole('button', { name: 'המשך' }).first();
      if (await globalContinueBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await globalContinueBtn.click({ force: true });
      }


      console.log("Navigating to Create Inquiry via UI...");
      const newInquiryTile = page.getByText(/פניה חדשה|יצירת פניה|פתיחת קריאה|מוקד 106/).first();
      await newInquiryTile.click();
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(2000);

      const optionBtn = page.locator(`button:has-text("${type.buttonText}"), div[role="button"]:has-text("${type.buttonText}")`).first();
      await expect(optionBtn).toBeVisible({ timeout: 15000 });
      await optionBtn.click();
      
      console.log("Waiting for form to stabilize...");
      await page.waitForTimeout(3000);

      if (type.is106) {
        console.log("Filling Subject (106)...");
        const subjectInput = page.locator('input[role="combobox"]:visible').first();
        await subjectInput.waitFor({ state: 'visible' });
        await subjectInput.click({ force: true });
        await page.waitForTimeout(1000);
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(500);
        await page.keyboard.press('Enter');
      } else {
        console.log("Filling Unit...");
        const unitInput = page.locator('input[role="combobox"]:visible').first();
        await unitInput.waitFor({ state: 'visible' });
        await unitInput.click({ force: true });
        await page.waitForTimeout(1000);
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(500);
        await page.keyboard.press('Enter');
        
        console.log("Waiting for Subject list to load...");
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(3000); 

        console.log("Filling Subject...");
        const subjectInput = page.locator('input[role="combobox"]:visible').nth(1);
        await subjectInput.waitFor({ state: 'visible' });
        await subjectInput.click({ force: true });
        await page.waitForTimeout(1000);
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(500);
        await page.keyboard.press('Enter');
      }

      await page.waitForTimeout(1000);

      const reportField = page.locator('input[name="reportNumber"]');
      if (await reportField.isVisible()) {
        console.log("Filling report number...");
        await reportField.fill("12345678");
      }

      console.log("Filling Street...");
      const streetInput = page.locator('input[role="combobox"][aria-autocomplete="list"]:visible').last();
      await streetInput.scrollIntoViewIfNeeded();
      await streetInput.click({ force: true });
      await streetInput.fill("א");
      await page.waitForTimeout(2000);
      const streetOption = page.getByRole('option').first();
      await streetOption.waitFor({ state: 'visible' });
      await streetOption.click({ force: true });

 
      console.log("Filling House Number...");
      const houseInput = page.locator('input[name="houseNumber"]');
      await houseInput.fill("12");

 
      console.log("Filling Details...");
      const detailsInput = page.locator('textarea[name="details"]');
      await detailsInput.fill("בדיקת סניטי אוטומטית - תיאור פנייה מפורט מעל חמש עשרה תווים");

 
      console.log("Submitting...");
      const sendBtn = page.locator('button:has-text("שליחה")');
      await expect(sendBtn).toBeEnabled();
      await sendBtn.click({ force: true });


      console.log("Validating success...");
      const successPopup = page.locator('text=בהצלחה').first();
      await expect(successPopup).toBeVisible({ timeout: 20000 });
      console.log(`✅ ${type.name} completed successfully (Mocked).`);

      console.log("Closing success popup...");
      const closeBtn = page.locator('button:has-text("סגירה"), button:has-text("אישור")').first();
      if (await closeBtn.isVisible()) {
          await closeBtn.click();
          await page.waitForTimeout(1000);
      }

    } catch (e) {
      console.log(`❌ Error in ${type.name}:`, (e as Error).message);
      hasErrors = true;
      errorSummary.push(type.name);
    }
  }
  
  if (hasErrors) {
    throw new Error(`Create Inquiries test failed in: ${errorSummary.join(', ')}`);
  } else {
    console.log("\n🏁 Integrated Sanity Run Finished Successfully.");
  }
});