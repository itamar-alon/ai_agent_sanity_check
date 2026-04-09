import { test, expect, Locator, Page } from '@playwright/test';

// ----------------------------
//  Handle payment portal
// ----------------------------
const handlePaymentPortal = async (trigger: Locator, contextName: string) => {
  console.log(`⏳ Triggering portal for ${contextName}...`);

  // נרשמים ל-new page לפני הלחיצה
  let newPagePromise = trigger.page().context().waitForEvent("page", { timeout: 15000 }).catch(() => null);

  // לוחצים על המחיר - force חובה כאן כדי לעקוף שכבות לא נראות
  await trigger.click({ force: true });

  // בודקים אם יש פופ-אפ של "המשך"
  const continueBtn = trigger.page().getByRole('button', { name: 'המשך' }).first();
  const isPopupVisible = await continueBtn.isVisible({ timeout: 5000 }).catch(() => false);

  if (isPopupVisible) {
    console.log(`🖱️ Popup detected. Clicking 'Continue'...`);
    // מאפסים את ה-promise כי הלחיצה על "המשך" היא זו שפותחת את החלון החדש
    newPagePromise = trigger.page().context().waitForEvent("page", { timeout: 30000 }).catch(() => null);
    await continueBtn.click({ force: true });
    // מחכים שהפופ אפ באמת ייעלם כדי לדעת שהקליק נרשם
    await continueBtn.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  } else {
    console.log(`ℹ️ No confirmation popup. Relying on initial click...`);
  }

  const newPage = await newPagePromise;
  
  if (newPage) {
    console.log(`✅ New tab opened for ${contextName}.`);
    await newPage.waitForLoadState("domcontentloaded").catch(() => {});
    return { portalPage: newPage, isNewTab: true };
  }

  console.log(`ℹ️ No new tab detected. Using current tab...`);
  return { portalPage: trigger.page(), isNewTab: false };
};

// ----------------------------
//  Verify portal loaded
// ----------------------------
const verifyPortalLoaded = async (portalPage: Page) => {
  await expect(async () => {
    // מחפשים iframe, אבל נוסיף גם גיבוי למקרה שהפורטל לא ב-iframe 
    // נחפש אלמנטים נפוצים בפורטל מילגם (כמו שדות ת.ז, מס' חשבון או כרטיס)
    // העדכון: הוספת :visible לכל בורר כדי לא להיתפס על אלמנטים מוסתרים (כמו טפסי ng-hide)
    const portalIndicators = portalPage.locator('iframe:visible, input[type="tel"]:visible, input#MisparHeshbon:visible, form:visible').first();
    await expect(portalIndicators).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 30000 });
};

// ----------------------------
//  Main test flow
// ----------------------------
test("Education - full flow", async ({ page, baseURL }) => {
  test.setTimeout(180000);
  let hasErrors = false;
  const errorSummary: string[] = [];

  console.log(`🚀 Starting Sanity Run - Education on: ${baseURL}`);

  await page.goto('/');

  // ניקוי עוגיות
  const cookieBtn = page.getByRole('button', { name: 'מאשר הכל' });
  if (await cookieBtn.isVisible({ timeout: 5000 })) {
    await cookieBtn.click();
    await cookieBtn.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  await page.getByText('חינוך').first().click();

  // --- התאמת סביבות: Test vs Pre-Prod/Prod ---
  // אם ה-baseURL לא מכיל 'test' (כלומר אנחנו בפרה-פרוד או פרודקשן)
  // נלחץ במפורש על הטאב "תיק תלמיד" כדי לוודא שאנחנו במסך הנכון
  if (baseURL && !baseURL.includes('test')) {
    console.log("🌍 Non-Test environment detected. Explicitly navigating to 'תיק תלמיד' tab...");
    await page.getByRole('tab', { name: 'תיק תלמיד' }).click();
  }
  // -------------------------------------------

  const noDataLocator = page.getByText('אין נתונים').first();
  const studentHeaderLocator = page.getByText('ת.ז:').first(); // הוספנו מזהה כללי לטעינת תיק תלמיד

  // ----------------------------
  // Student Payments
  // ----------------------------
  try {
    console.log("🔍 Checking tab: Student Payments...");

    // התיקון: ניווט מפורש לטאב תשלומי חינוך כדי למנוע מצב שבו המערכת זוכרת טאב אחר מהיסטוריית הגלישה
    await page.getByRole("tab", { name: "תשלומי חינוך" }).click();

    // עדכון הבורר לפי בקשתך - לחיצה על כפתור התשלום הספציפי
    const paymentLink = page.locator('a[aria-label="לחץ כאן כדי לשלם את כלל היתרות"]').first();
    
    // מצפים לראות את כפתור התשלום, או "אין נתונים", או נתוני תלמיד שמוכיחים שהעמוד נטען (גם אם אין חוב)
    await expect(paymentLink.or(noDataLocator).or(studentHeaderLocator).first()).toBeVisible({ timeout: 30000 });

    if (await paymentLink.isVisible()) {
      const { portalPage, isNewTab } = await handlePaymentPortal(paymentLink, "Student Payments");

      await verifyPortalLoaded(portalPage);
      console.log("✅ Student Payments portal verified.");

      if (isNewTab) await portalPage.close();
      else await portalPage.goBack({ waitUntil: "load" }).catch(()=>{});
    } else {
      console.log("ℹ️ Student Payments: No payment link available (either no debt or no data).");
    }
  } catch (err) {
    console.error("❌ Student Payments Error:", (err as Error).message);
    hasErrors = true;
    errorSummary.push("Student Payments");
  }

  // ----------------------------
  // Additional Payments
  // ----------------------------
  try {
    console.log("🔍 Checking tab: Additional Payments...");
    await page.getByRole("tab", { name: "תשלומים נוספים" }).click();

    const balanceLink = page.locator('span[aria-label*="₪"]').first();
    
    // גם כאן מזהים נתוני תלמיד כמצב חוקי שבו העמוד נטען אך אין תשלומים
    await expect(balanceLink.or(noDataLocator).or(studentHeaderLocator).first()).toBeVisible({ timeout: 30000 });

    if (await balanceLink.isVisible()) {
      const { portalPage, isNewTab } = await handlePaymentPortal(balanceLink, "Additional Payments");

      await verifyPortalLoaded(portalPage);
      console.log("✅ Additional Payments portal verified.");

      if (isNewTab) await portalPage.close();
      else await portalPage.goBack({ waitUntil: "load" }).catch(()=>{});
    } else {
      console.log("ℹ️ Additional Payments: No payment link available (either no debt or no data).");
    }
  } catch (err) {
    console.error("❌ Additional Payments Error:", (err as Error).message);
    hasErrors = true;
    errorSummary.push("Additional Payments");
  }

  // ----------------------------
  // Registration and Placement
  // ----------------------------
  try {
    console.log("🔍 Checking tab: Registration and Placement...");
    
    await expect(async () => {
         await page.getByRole('tab', { name: 'רישום/שיבוץ' }).click({ force: true });
    }).toPass({timeout: 5000});

    const regData = page.locator('span[aria-label^="0"], span[aria-label^="1"]').first();
    await expect(regData.or(noDataLocator).first()).toBeVisible({ timeout: 20000 });

    console.log("✅ Registration data found.");
  } catch (err) {
    console.error("❌ Registration/Placement Error:", (err as Error).message);
    hasErrors = true;
    errorSummary.push("Registration/Placement");
  }

  // ----------------------------
  // Finalize
  // ----------------------------
  if (hasErrors) {
    throw new Error(`Education failed: ${errorSummary.join(", ")}`);
  }

  console.log("🎉 Education Sanity completed successfully!");
});