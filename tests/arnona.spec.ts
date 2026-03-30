import { test, expect } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
dotenv.config();

test('Arnona - full flow', async ({ page }) => {

  // Navigate directly to arnona and login
  await page.goto(`${process.env.BASE_URL}/arnona/`);
  await page.click('button:has-text("התחברות"), a:has-text("התחברות")');
  await page.click('button[role="tab"]:has-text("באמצעות סיסמה")');
  await page.fill('input[name="tz"]', process.env.TEST_ID!);
  await page.fill('input[name="password"]', process.env.TEST_PASSWORD!);
  await page.locator('button[type="button"]:has-text("כניסה")').last().click();
  await page.waitForLoadState('networkidle');

  // נכסים - check data is shown
  await expect(page.locator('span.truncate').first()).toBeVisible({ timeout: 10000 });

  // מצב חשבון
  await page.click('a:has-text("מצב חשבון"), button:has-text("מצב חשבון")');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[aria-label*="₪"]').first()).toBeVisible({ timeout: 10000 });

  // צפיה בשוברים
  await page.click('a:has-text("צפיה בשוברים"), button:has-text("צפיה בשוברים")');
  await page.waitForLoadState('networkidle');
  
  // תיקון: במקום לחפש span.truncate שלא קיים, מחכים שהדרופדאון עצמו יהיה מוכן
  await expect(page.locator('.MuiSelect-select').nth(0)).toBeVisible({ timeout: 10000 });

  // Select משלם (first dropdown - second option)
  await page.locator('.MuiSelect-select').nth(0).click();
  // תיקון: שימוש ב-nth(1) כדי לבחור את תעודת הזהות השנייה ברשימה
  await page.locator('[role="option"]').nth(1).click();
  await page.waitForLoadState('networkidle');

  // Select year (second dropdown - second option)
  try {
    await expect(page.locator('.MuiSelect-select').nth(1)).toBeVisible({ timeout: 3000 });
    await page.locator('.MuiSelect-select').nth(1).click();
    await page.locator('[role="option"]').nth(1).click();
    await page.waitForLoadState('networkidle');
  } catch (e) {
    console.log("דרופדאון השנה לא הופיע במסך, ממשיכים הלאה להורדה.");
  }

  // ממתינים שהקבצים באמת יטענו ויופיעו במסך לפני שמנסים להוריד
  await page.waitForSelector('a:has-text("צפייה"), button:has-text("צפייה")', { state: 'visible', timeout: 15000 });

  const downloadPromise1 = page.waitForEvent('download');
  // לחיצה על הלינק 'צפייה' שיזום את ההורדה
  await page.locator('a:has-text("צפייה"), button:has-text("צפייה")').first().click();
  const download1 = await downloadPromise1;
  const filePath1 = path.join(__dirname, download1.suggestedFilename());
  await download1.saveAs(filePath1);
  console.log(`✅ שובר הורד בהצלחה ונשמר ב: ${filePath1}`);
  // מחיקת הקובץ מיד לאחר ההורדה
  fs.unlinkSync(filePath1);
  console.log(`🗑️ השובר נמחק מהתיקייה.`);

  // קבלות בגין תשלום
  await page.click('a:has-text("קבלות בגין תשלום"), button:has-text("קבלות בגין תשלום")');
  await page.waitForLoadState('networkidle');
  
  // תיקון: יישום אותו הגיון כאן כדי למנוע קריסה
  await expect(page.locator('.MuiSelect-select').nth(0)).toBeVisible({ timeout: 10000 });

  // Select משלם (first dropdown - second option)
  await page.locator('.MuiSelect-select').nth(0).click();
  await page.locator('[role="option"]').nth(1).click();
  await page.waitForLoadState('networkidle');

  // Select year (second dropdown - second option)
  try {
    await expect(page.locator('.MuiSelect-select').nth(1)).toBeVisible({ timeout: 3000 });
    await page.locator('.MuiSelect-select').nth(1).click();
    await page.locator('[role="option"]').nth(1).click();
    await page.waitForLoadState('networkidle');
  } catch (e) {
    console.log("דרופדאון השנה לא הופיע במסך, ממשיכים הלאה להורדה.");
  }

  // ממתינים שהקבצים באמת יטענו ויופיעו במסך לפני שמנסים להוריד
  await page.waitForSelector('a:has-text("צפייה"), button:has-text("צפייה")', { state: 'visible', timeout: 15000 });

  const downloadPromise2 = page.waitForEvent('download');
  // לחיצה על הלינק 'צפייה' שיזום את ההורדה
  await page.locator('a:has-text("צפייה"), button:has-text("צפייה")').first().click();
  const download2 = await downloadPromise2;
  const filePath2 = path.join(__dirname, download2.suggestedFilename());
  await download2.saveAs(filePath2);
  console.log(`✅ קבלה הורדה בהצלחה ונשמרה ב: ${filePath2}`);
  // מחיקת הקובץ מיד לאחר ההורדה
  fs.unlinkSync(filePath2);
  console.log(`🗑️ הקבלה נמחקה מהתיקייה.`);

});