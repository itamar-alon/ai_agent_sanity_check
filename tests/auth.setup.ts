import { test as setup, expect } from '@playwright/test';

/**
 * פרויקט Setup: מתחבר פעם אחת ושומר את העוגיות לכל שאר הטסטים
 */
const authFile = 'playwright/.auth/user.json';

setup('authenticate', async ({ page, baseURL }) => {
  console.log(`🔐 Starting Global Authentication on: ${baseURL}`);

  // בדיקה שהכתובת תקינה
  if (!baseURL) {
    throw new Error("❌ Error: baseURL is undefined. Check your .env file for URL_TEST.");
  }

  // 1. ניווט לכתובת הבסיס (כבר מכיל את ה-URL מה-env)
  await page.goto(baseURL);

  // 2. פתיחת מודל ההתחברות (תומך בכפתור או לינק)
  await page.click('button:has-text("כניסה"), a:has-text("כניסה")');
  
  // 3. בחירת טאב סיסמה
  await page.click('button[role="tab"]:has-text("באמצעות סיסמה")');
  
  // 4. מילוי פרטים מה-env (ת"ז וסיסמה)
  console.log("⌨️ Filling credentials...");
  await page.fill('input[name="tz"]', process.env.TEST_ID!);
  await page.fill('input[name="password"]', process.env.TEST_PASSWORD!);

  // 5. לחיצה על כפתור הכניסה
  // משתמשים ב-.last() כי לפעמים יש כפתור כניסה נוסף ברקע של האתר
  await page.locator('button[type="button"]:has-text("כניסה")').last().click();
  
  // 6. וידוא שהצלחנו (מחכים שה-URL של הלוגין ייעלם)
  console.log("⏳ Waiting for login to complete...");
  await expect(page).not.toHaveURL(/login/, { timeout: 20000 });

  // --- 🍪 Cookie Slayer 🍪 ---
  console.log("🔍 Checking for Cookie Banner...");
  try {
    const cookieBtn = page.locator('button:has-text("אישור"), button:has-text("מאשר"), button:has-text("Accept")').first();
    if (await cookieBtn.isVisible({ timeout: 5000 })) {
      await cookieBtn.click();
      console.log("✅ Cookies accepted and state will be saved.");
    }
  } catch (e) {
    console.log("ℹ️ No cookie banner found in Setup.");
  }
  
  // 7. שמירת הסטייט (עוגיות ו-Local Storage) לקובץ
  await page.context().storageState({ path: authFile });

  
  console.log("✅ Authentication successful! Storage state saved to:", authFile);
});