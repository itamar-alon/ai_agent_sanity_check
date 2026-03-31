import { test, expect } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config();

test('Appointments - full login flow and dynamic booking with Mock', async ({ page }) => {
  test.setTimeout(200000);
  let hasErrors = false;
  let errorSummary: string[] = [];

  console.log("🚀 Starting Sanity Run - Appointments");

  // שלב 1: התחברות דרך דף הבית
  await page.goto(`${process.env.BASE_URL}`);
  await page.click('button:has-text("כניסה"), a:has-text("כניסה")');
  await page.click('button[role="tab"]:has-text("באמצעות סיסמה")');
  await page.fill('input[name="tz"]', process.env.TEST_ID!);
  await page.fill('input[name="password"]', process.env.TEST_PASSWORD!);
  await page.locator('button[type="button"]:has-text("כניסה")').last().click();
  await page.waitForLoadState('networkidle');

  // שלב 2: הגדרת ה-Mock לפני המעבר לדף הפגישות
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
    // שלב 3: מעבר לממשק הפגישות
    console.log("Navigating to Appointments wizard...");
    await page.goto(`${process.env.BASE_URL}/פגישות/`);
    await page.waitForLoadState('networkidle');

    // ביצוע שלבי הבחירה (1-3)
    for (let step = 1; step <= 3; step++) {
      console.log(`Selecting option for Step ${step}...`);
      await page.waitForTimeout(2000); 
      
      const activeStepContent = page.locator('.MuiStepContent-root').locator('visible=true');
      const optionToClick = activeStepContent.locator('div[role="button"], li.MuiListItem-root, input[type="radio"] + *').first();
      
      await expect(optionToClick).toBeVisible({ timeout: 20000 });
      await optionToClick.click();
      await page.waitForLoadState('networkidle');
    }

    // שלב 4: בחירת תאריך ושעה דינמית
    console.log("Handling dynamic dates and times...");
    let appointmentFound = false;
    let monthsChecked = 0;

    while (!appointmentFound && monthsChecked < 3) {
      await page.waitForTimeout(2500);
      
      const availableDates = page.locator('button.MuiPickersDay-root:not(.Mui-disabled):not(.MuiPickersDay-hiddenDaySpacingFiller)');
      const datesCount = await availableDates.count();

      for (let i = 0; i < datesCount; i++) {
        await availableDates.nth(i).click();
        await page.waitForTimeout(2000);

        const timeSlots = page.locator('button, div[role="button"], span.MuiChip-root')
          .filter({ hasText: /^\d{1,2}:\d{2}$/ })
          .filter({ hasNot: page.locator('.Mui-disabled') });
        
        if (await timeSlots.count() > 0) {
          console.log("✅ Time slot found, selecting...");
          await timeSlots.first().click();
          appointmentFound = true;
          break; 
        }
      }

      if (!appointmentFound) {
        console.log("No times found in current month, moving to next month...");
        const nextMonthBtn = page.locator('svg[data-testid="ChevronLeftIcon"]').locator('..');
        if (await nextMonthBtn.isVisible()) {
          await nextMonthBtn.click();
          monthsChecked++;
        } else {
          break; 
        }
      }
    }

    if (!appointmentFound) {
      throw new Error("Could not find any available appointments in the next 3 months.");
    }

    // שלב 5: שליחת הבקשה (שתיחטף על ידי ה-Mock)
    console.log("Submitting appointment request...");
    // התיקון כאן: שימוש בקלאס הספציפי והתאמת טקסט מדויקת
    const submitBtn = page.locator('button.MuiButton-containedWarning', { hasText: /^זימון פגישה$/ }).first();
    await expect(submitBtn).toBeVisible({ timeout: 15000 });
    await submitBtn.click();

    // שלב 6: אימות הודעת הצלחה
    console.log("Verifying success message...");
    const successMessage = page.locator('h4.text-center.mt-4.font-bold:has-text("פגישתך נקבעה בהצלחה")');
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