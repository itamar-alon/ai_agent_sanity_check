import { test, expect } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config();

test('Street Info - dynamic check', async ({ page }) => {
  test.setTimeout(120000);
  let hasErrors = false;
  let errorSummary: string[] = [];

  console.log("🚀 Starting Sanity Run - Street Info");

  await page.goto(`${process.env.BASE_URL}/street-info/`);
  await page.waitForLoadState('networkidle');

  try {
    console.log("Selecting a street from the dropdown...");
    const dropdown = page.locator('input[role="combobox"]');
    await dropdown.click();
    await dropdown.fill('א');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle');

    console.log("Verifying primary data existence...");
    const infoContainer = page.locator('div.font-bold, div.font-semibold').first();
    await expect(infoContainer).toBeVisible({ timeout: 15000 });
    const primaryText = await infoContainer.innerText();
    console.log(`✅ Data found: ${primaryText}`);

    const plusButton = page.locator('svg[data-testid="AddCircleOutlineIcon"]').first();
    const isPlusPresent = await plusButton.isVisible();

    if (isPlusPresent) {
      console.log("Plus button found, clicking for details...");
      await plusButton.click();
      await page.waitForTimeout(2000);
      
      const details = page.locator('p').filter({ hasNotText: 'מצב תצוגה אופקי' }).filter({ hasText: /./ }).first();
      await expect(details).toBeVisible({ timeout: 10000 });
      console.log("✅ Detail data verified.");
    } else {
      console.log("ℹ️ No Plus button present for this street, skipping detailed check.");
    }

  } catch (e) {
    console.log("❌ Error in Street Info flow:", (e as Error).message);
    hasErrors = true;
    errorSummary.push("Street Data Visibility");
  }

  if (hasErrors) {
    throw new Error(`Street Info test failed: ${errorSummary.join(', ')}`);
  } else {
    console.log("🎉 Street Info verification completed!");
  }
});