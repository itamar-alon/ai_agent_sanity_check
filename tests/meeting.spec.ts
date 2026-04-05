import { test, expect } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config();

test('Appointments - full login flow and dynamic booking with Mock', async ({ page }) => {
  test.setTimeout(250000);
  let hasErrors = false;
  let errorSummary: string[] = [];

  console.log("🚀 Starting Sanity Run - Appointments");

  // שלב 1: התחברות
  await page.goto(`${process.env.BASE_URL}`);
  await page.click('button:has-text("כניסה"), a:has-text("כניסה")');
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

  // שלב 2: הגדרת ה-Mock
  await page.route('**/SetAppointment*', async route => {
    console.log("🛡️ INITIATING MOCK: Intercepted real appointment request!");
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        SetAppointmentData: { ServiceId: 262, DateAndTime: "2026-04-01T08:30:00" },
        ScriptResults: { Messages: [], ReturnCode: 0 },
        CaseId: 1813505,
        ProcessId: 1813214,
        AppointmentId: 204169,
        CalendarId: 91583,
        QNumber: 0,
        QCode: "",
        CustomerTreatmentPlanId: 0
      })
    });
    console.log("✅ MOCK SUCCESS: Injected fake confirmation response.");
  });

  try {
    // --- התיקון הגדול: מנגנון רענון דף חכם למקרה שאין תוצאות ---
    let wizardReady = false;

    for (let wizardAttempt = 1; wizardAttempt <= 3; wizardAttempt++) {
      console.log(`Navigating to Appointments wizard (Attempt ${wizardAttempt}/3)...`);
      await page.goto(`${process.env.BASE_URL}/פגישות/`);
      await page.waitForLoadState('networkidle');

      let errorInSteps = false;

      for (let step = 1; step <= 3; step++) {
        console.log(`Selecting option for Step ${step}...`);
        await page.waitForTimeout(2000); // ממתינים לתשובה מהשרת
        
        // בדיקה: האם קפץ "אין תוצאות חיפוש מתאימות"?
        const noResultsMsg = page.locator('text="אין תוצאות חיפוש מתאימות"').first();
        if (await noResultsMsg.isVisible()) {
          console.log(`⚠️ 'No matching results' found at Step ${step}. Refreshing the page...`);
          errorInSteps = true;
          break; // שובר את לולאת השלבים וקופץ חזרה לרענון הדף (wizardAttempt)
        }

        try {
          const activeStepContent = page.locator('.MuiStepContent-root:visible').last();
          const optionToClick = activeStepContent.locator('div[role="button"], li.MuiListItem-root, input[type="radio"] + *').first();
          
          await expect(optionToClick).toBeVisible({ timeout: 10000 });
          await optionToClick.click({ force: true });
          await page.waitForLoadState('networkidle');
        } catch (err) {
          console.log(`⚠️ Step ${step} failed to load options properly. Refreshing the page...`);
          errorInSteps = true;
          break;
        }
      }

      // אם סיימנו את הלולאה (1-3) בלי שגיאות רענון, אנחנו מוכנים להמשיך
      if (!errorInSteps) {
        wizardReady = true;
        break; 
      }
    }

    if (!wizardReady) {
      throw new Error("Failed to load appointment wizard options after 3 reloads. API might be down.");
    }
    // ------------------------------------------------------------------

    // שלב 4: בחירת תאריך ושעה דינמית 
    console.log("Handling dynamic dates and times...");
    let appointmentFound = false;
    let monthsChecked = 0;

    while (!appointmentFound && monthsChecked < 3) {
      await page.waitForTimeout(3000); 
      
      const daysLocator = page.locator('button.MuiPickersDay-root:visible:not(.Mui-disabled):not(.MuiPickersDay-hiddenDaySpacingFiller)');
      const datesCount = await daysLocator.count();
      console.log(`🔍 Found ${datesCount} available dates in current month.`);

      for (let i = 0; i < datesCount; i++) {
        await page.waitForTimeout(1000); 
        
        const dateBtn = daysLocator.nth(i);
        
        try {
          await expect(dateBtn).toBeVisible({ timeout: 10000 });
          await dateBtn.evaluate(el => el.style.border = '3px solid yellow');
          console.log(`🗓️ Clicking date #${i + 1} of ${datesCount}...`);
          await dateBtn.click({ force: true });
        } catch (e) {
          console.log(`⚠️ Could not interact with date #${i + 1}. Moving to the next date...`);
          continue; 
        }

        await page.waitForTimeout(2500); 

        const timeSlots = page.locator('button:visible, div[role="button"]:visible, span.MuiChip-root:visible')
          .filter({ hasText: /^\d{1,2}:\d{2}$/ })
          .filter({ hasNot: page.locator('[disabled], .Mui-disabled') });
        
        const slotsCount = await timeSlots.count();
        if (slotsCount > 0) {
          console.log(`✅ Found ${slotsCount} visible time slots! Selecting the first one...`);
          await timeSlots.first().click({ force: true });
          appointmentFound = true;
          break; 
        } else {
          console.log(`ℹ️ Date #${i + 1} has no times available.`);
          
          const backBtn = page.locator('text="חזור"').first();
          if (await backBtn.isVisible({ timeout: 3000 })) {
             console.log("🔙 Clicking 'Back' to return to the calendar view...");
             await backBtn.click({ force: true });
             await page.waitForTimeout(2000); 
          } else {
             const step4Header = page.locator('text="מועדים פנויים לפגישה"').first();
             if (await step4Header.isVisible()) {
                console.log("🔙 Clicking Step 4 Header to reopen calendar...");
                await step4Header.click({ force: true });
                await page.waitForTimeout(2000);
             }
          }
          console.log("Moving to the next available date...");
          continue; 
        }
      }

      if (!appointmentFound) {
        console.log("⏩ Month finished without results. Moving to Next Month...");
        const nextMonthBtn = page.locator('svg[data-testid="ChevronLeftIcon"]:visible').first().locator('..');
        try {
          if (await nextMonthBtn.isVisible({ timeout: 5000 })) {
            await nextMonthBtn.click({ force: true });
            monthsChecked++;
            await page.waitForTimeout(2000); 
          } else {
            console.log("❌ No Next Month button available.");
            break; 
          }
        } catch (err) {
          console.log("❌ Failed to click Next Month.");
          break;
        }
      }
    }

    if (!appointmentFound) {
      throw new Error("Could not find any available appointments in the next 3 months.");
    }

    // שלב 5: שליחת הבקשה (Mock)
    console.log("Submitting appointment request...");
    const submitBtn = page.locator('button.MuiButton-containedWarning:visible', { hasText: /^זימון פגישה$/ }).first();
    await expect(submitBtn).toBeVisible({ timeout: 15000 });
    await submitBtn.click();

    // שלב 6: אימות הצלחה
    console.log("Verifying success message...");
    const successMessage = page.locator('h4.text-center.mt-4.font-bold:visible:has-text("פגישתך נקבעה בהצלחה")');
    await expect(successMessage).toBeVisible({ timeout: 20000 });
    console.log("🎉 Appointment flow completed successfully (Mocked).");

  } catch (e) {
    console.log("❌ Error in Appointment flow:", (e as Error).message);
    hasErrors = true;
    errorSummary.push("Appointment Booking");
  }

  if (hasErrors) {
    throw new Error(`Appointments test failed in: ${errorSummary.join(', ')}`);
  } else {
    console.log("✅ Sanity completed!");
  }
});