import { test, expect } from '@playwright/test';

test('Parking - full flow', async ({ page, baseURL }) => {
  test.setTimeout(180000);

  let hasErrors = false;
  let errorSummary: string[] = [];

  console.log(`🚀 Starting Sanity Run - Parking via UI Navigation on: ${baseURL}`);

  // 1. כניסה לדף הבית
  await page.goto('/'); 

  // 2. לחיצה על האריח "חניה/ תו חניה" בדף הבית
  console.log("🖱️ Clicking on 'Parking' tile from Homepage...");
  const parkingTile = page.getByText('חניה/ תו חניה').first();
  await parkingTile.click();

  // 3. לחיצה על הטאב הספציפי: "דו"חות חניה - מידע אישי"
  // זה מבטיח שאנחנו מגיעים ל-URL עם ה-tab=1 וה-unpaid
  console.log("🖱️ Switching to tab: 'דו\"חות חניה - מידע אישי'...");
  const ticketsTab = page.locator('button, a, span').filter({ hasText: 'דו"חות חניה - מידע אישי' }).first();
  
  try {
    await ticketsTab.waitFor({ state: 'visible', timeout: 15000 });
    await ticketsTab.click();
    console.log("✅ Tab selected successfully.");
  } catch (e) {
    console.log("ℹ️ Tab might already be selected or selector needs adjustment.");
  }

  // 4. המתנה לנתונים (או הודעת "אין נתונים")
  const noDataLocator = page.getByText('אין נתונים');
  const ticketItem = page.locator('div[role="button"].toggle-list-item').first();

  console.log("⏳ Waiting for data to populate...");
  try {
    // מחכים עד 30 שניות שייראו נתונים או הודעת שגיאה/חוסר נתונים
    await expect(ticketItem.or(noDataLocator)).toBeVisible({ timeout: 30000 });
    console.log("✅ Data/State determined.");
  } catch (e) {
    console.log("⚠️ Data didn't load. Trying a quick manual refresh...");
    await page.reload();
    await expect(ticketItem.or(noDataLocator)).toBeVisible({ timeout: 20000 });
  }

  // --- בדיקה 1: דוחות שלא שולמו ---
  try {
    if (await noDataLocator.isVisible()) {
      console.log("ℹ️ Unpaid Tickets: No tickets found (Valid state).");
    } else {
      console.log("🔍 Checking ticket details...");
      await ticketItem.click();
      
      const priceTag = page.locator('span.sou').filter({ hasText: '₪' }).first();
      await expect(priceTag).toBeVisible({ timeout: 15000 });
      
      const originalAmountRaw = await priceTag.innerText();
      const originalAmount = originalAmountRaw.replace(/[^0-9.]/g, '').trim();
      console.log(`✅ Ticket amount verified: ${originalAmount}`);

      // מעבר לפורטל תשלומים
      console.log("⏳ Opening payment portal...");
      const [paymentPage] = await Promise.all([
        page.context().waitForEvent('page', { timeout: 30000 }),
        page.locator('button:has-text("לתשלום")').first().click(),
      ]);

      await paymentPage.waitForLoadState('load');
      await paymentPage.locator('button[aria-label="הצג סכום"]').click();
      await expect(paymentPage.locator('label#sumResult')).toContainText(originalAmount, { timeout: 20000 });
      console.log("✅ Payment portal matches amount.");
      await paymentPage.close();
    }
  } catch (e) {
    console.error("❌ Error in Unpaid Tickets:", (e as Error).message);
    hasErrors = true;
    errorSummary.push("Unpaid Tickets");
  }

  // --- בדיקה 2: דוחות ששולמו ---
  try {
    console.log("🔍 Checking Paid Tickets history...");
    const paidTab = page.locator('button[role="tab"]:has-text("דוחות ששולמו"), a:has-text("דוחות ששולמו")');
    await paidTab.click();
    
    const paidItem = page.locator('div[role="button"].toggle-list-item').first();
    const noPaidData = page.getByText('אין נתונים');

    await expect(paidItem.or(noPaidData)).toBeVisible({ timeout: 20000 });
    console.log("✅ Paid tickets history verified.");
  } catch (e) {
    console.error("❌ Error in Paid Tickets tab:", (e as Error).message);
    hasErrors = true;
    errorSummary.push("Paid Tickets History");
  }

  if (hasErrors) {
    throw new Error(`Parking failed: ${errorSummary.join(', ')}`);
  } else {
    console.log("🎉 Parking Sanity completed successfully!");
  }
});