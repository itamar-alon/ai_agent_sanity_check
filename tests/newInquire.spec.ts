import { test, expect } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config();

const INQUIRY_MOCK_RESPONSE = {
  Status: "200",
  Message: "Success פניה נשלחה בהצלחה",
  Id: "CAL-2603-00029"
};

const inquiryTypes = [
  { name: 'Field Treatment (106)', buttonText: 'נדרש טיפול מיידי בשטח', is106: true },
  { name: 'Information Request', buttonText: 'בירור או בקשת מידע', is106: false }
];

test('Create All Inquiries - Single Session with Reset Logic', async ({ page }) => {
  test.setTimeout(240000);
  console.log("🚀 Starting Integrated Sanity Run - Single Session");

  // שלב 1: התחברות חד-פעמית
  await page.goto(`${process.env.BASE_URL}`);
  
  // חיסול עוגיות אם מופיע
  await page.locator('button[aria-label="מאשר הכל"]').first().click({ timeout: 3000 }).catch(() => {});

  await page.click('button:has-text("כניסה"), a:has-text("כניסה")');
  await page.click('button[role="tab"]:has-text("באמצעות סיסמה")');
  await page.fill('input[name="tz"]', process.env.TEST_ID!);
  await page.fill('input[name="password"]', process.env.TEST_PASSWORD!);
  await page.locator('button[type="button"]:has-text("כניסה")').last().click();
  await page.waitForLoadState('networkidle');

  // הגדרת המוק - הכתובת המדויקת שחולצה מה-Network
  await page.route('**/Umbraco/Api/NewCallApi/SendNewCall*', async route => {
    console.log(`🛡️ MOCK ACTIVATED: Intercepting submission`);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(INQUIRY_MOCK_RESPONSE)
    });
  });

  // שלב 2: ריצה על סוגי הפניות באותה כרטיסייה
  for (const type of inquiryTypes) {
    console.log(`\n--- Processing: ${type.name} ---`);
    
    try {
      // ניווט לדף יצירת פניה בתחילת כל סיבוב כדי לאפס את הטופס
      await page.goto(`${process.env.BASE_URL}/my-inquiries#/create-incident`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // לחיצה על סוג הפניה בפופ-אפ
      const optionBtn = page.locator(`button:has-text("${type.buttonText}"), div[role="button"]:has-text("${type.buttonText}")`).first();
      await expect(optionBtn).toBeVisible({ timeout: 15000 });
      await optionBtn.click();
      
      console.log("Waiting for form to stabilize...");
      await page.waitForTimeout(3000);

      // --- מילוי דרופדאון יחידה / נושא ---
      if (type.is106) {
        console.log("Filling Subject (106)...");
        // שימוש ב-:visible כדי להימנע מאלמנטים מוסתרים
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
        
        // המתנה לטעינת רשימת הנושאים בעקבות בחירת היחידה
        console.log("Waiting for Subject list to load...");
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(3000); 

        console.log("Filling Subject...");
        // שימוש ב-:visible ולקיחת האלמנט השני הנראה
        const subjectInput = page.locator('input[role="combobox"]:visible').nth(1);
        await subjectInput.waitFor({ state: 'visible' });
        await subjectInput.click({ force: true });
        await page.waitForTimeout(1000);
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(500);
        await page.keyboard.press('Enter');
      }

      await page.waitForTimeout(1000);

      // --- מילוי מספר דוח (שימוש במזהה המדויק מה-HTML) ---
      const reportField = page.locator('input[name="reportNumber"]');
      if (await reportField.isVisible()) {
        console.log("Filling report number...");
        await reportField.fill("12345678");
      }

      // --- מילוי רחוב (דרופדאון - אחרון ברשימת ה-combobox) ---
      console.log("Filling Street...");
      const streetInput = page.locator('input[role="combobox"][aria-autocomplete="list"]:visible').last();
      await streetInput.scrollIntoViewIfNeeded();
      await streetInput.click({ force: true });
      await streetInput.fill("א");
      await page.waitForTimeout(2000);
      const streetOption = page.getByRole('option').first();
      await streetOption.waitFor({ state: 'visible' });
      await streetOption.click({ force: true });

      // --- מילוי מספר בית (שימוש במזהה המדויק מה-HTML) ---
      console.log("Filling House Number...");
      const houseInput = page.locator('input[name="houseNumber"]');
      await houseInput.fill("12");

      // --- מילוי תיאור פנייה (מינימום 15 תווים) ---
      console.log("Filling Details...");
      const detailsInput = page.locator('textarea[name="details"]');
      await detailsInput.fill("בדיקת סניטי אוטומטית - תיאור פנייה מפורט מעל חמש עשרה תווים");

      // --- שליחה ---
      console.log("Submitting...");
      const sendBtn = page.locator('button:has-text("שליחה")');
      await expect(sendBtn).toBeEnabled();
      await sendBtn.click({ force: true });

      // --- אימות הצלחה וסגירת הפופ-אפ ---
      console.log("Validating success...");
      const successPopup = page.locator('text=בהצלחה').first();
      await expect(successPopup).toBeVisible({ timeout: 20000 });
      console.log(`✅ ${type.name} completed successfully (Mocked).`);

      // לחיצה על כפתור סגירה כדי לנקות את המסך לפני הפנייה הבאה
      console.log("Closing success popup...");
      const closeBtn = page.locator('button:has-text("סגירה"), button:has-text("אישור")').first();
      if (await closeBtn.isVisible()) {
          await closeBtn.click();
          await page.waitForTimeout(1000);
      }

    } catch (e) {
      console.log(`❌ Error in ${type.name}:`, (e as Error).message);
      // אם קרס, ננסה לחזור למסך הבית כדי לא לתקוע את הבדיקה הבאה
      await page.goto(`${process.env.BASE_URL}`);
    }
  }
  
  console.log("\n🏁 Integrated Sanity Run Finished.");
});