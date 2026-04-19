import { test as setup, expect } from '@playwright/test';

const authFile = 'playwright/.auth/user.json';

setup('authenticate', async ({ page, baseURL }) => {
   console.log(`🔐 Starting Global Authentication on: ${baseURL}`);

   if (!baseURL) {
     throw new Error("❌ Error: baseURL is undefined. Check your .env file for URL_TEST.");
   }

   if (!process.env.USER_ID || !process.env.USER_PASSWORD) {
     throw new Error("❌ Error: USER_ID or USER_PASSWORD are missing from the environment variables.");
   }

   await page.goto(baseURL);

   console.log("🔍 Checking for Cookie Banner...");
   try {
     const cookieBtn = page.locator('button:has-text("אישור"), button:has-text("מאשר"), button:has-text("Accept")').first();
     if (await cookieBtn.isVisible({ timeout: 5000 })) {
       await cookieBtn.click();
       console.log("✅ Cookies accepted.");
     }
   } catch (e) {
     console.log("ℹ️ No cookie banner found in Setup.");
   }

   await page.click('button:has-text("כניסה"), a:has-text("כניסה")');
   
   await page.click('button[role="tab"]:has-text("באמצעות סיסמה")');
   
   console.log("⌨️ Filling credentials...");
   await page.getByRole('textbox', { name: 'תעודת זהות' }).fill(process.env.USER_ID);
   await page.getByRole('textbox', { name: 'הזן סיסמא' }).fill(process.env.USER_PASSWORD);

   console.log("⏳ Submitting and waiting for login to complete...");
   
   await Promise.all([
      page.waitForLoadState('networkidle'), 
      page.locator('button[type="button"]:has-text("כניסה")').last().click()
   ]);
   
   await expect(page.locator('.MuiDialog-container')).toBeHidden({ timeout: 15000 });

   await page.context().storageState({ path: authFile });

   console.log("✅ Authentication successful! Storage state saved to:", authFile);
});