import { test, expect } from '@playwright/test';

test('Parking - full flow', async ({ page, baseURL }) => {
  test.setTimeout(180000);

  let hasErrors = false;
  let errorSummary: string[] = [];

  console.log(`🚀 Starting Sanity Run - Parking via UI Navigation on: ${baseURL}`);

  await page.goto('/'); 

  try {
    const cookieBtn = page.locator('button:has-text("מאשר הכל")');
    if (await cookieBtn.isVisible({ timeout: 5000 })) {
      await cookieBtn.click();
    }
  } catch (e) {}

  console.log("🖱️ Clicking on 'Parking' tile from Homepage...");
  const parkingTile = page.getByText('חניה/ תו חניה').first();
  await parkingTile.click();

  console.log("🖱️ Switching to tab: 'דו\"חות חניה - מידע אישי'...");
  const ticketsTab = page.locator('button, a, span').filter({ hasText: 'דו"חות חניה - מידע אישי' }).first();
  
  try {
    await ticketsTab.waitFor({ state: 'visible', timeout: 15000 });
    await ticketsTab.click();
    console.log("✅ Tab selected successfully.");
  } catch (e) {
    console.log("ℹ️ Tab might already be selected or selector needs adjustment.");
  }

  const noDataLocator = page.getByText('לא נמצאו דוחות');
  const ticketItem = page.locator('div[role="button"].toggle-list-item').first();

  console.log("⏳ Waiting for data to populate...");
  try {
    await expect(ticketItem.or(noDataLocator)).toBeVisible({ timeout: 30000 });
    console.log("✅ Data/State determined.");
  } catch (e) {
    console.log("⚠️ Data didn't load. Trying a quick manual refresh...");
    await page.reload();
    await expect(ticketItem.or(noDataLocator)).toBeVisible({ timeout: 20000 });
  }

  try {
    if (await noDataLocator.isVisible()) {
      console.log("ℹ️ Unpaid Tickets: No tickets found (Valid state).");
    } else {
      console.log("🔍 Checking ticket details...");
      await ticketItem.click();
      
      const amountToPayLocator = page.locator('p:has-text("סכום לתשלום:"), div:has-text("סכום לתשלום:")').locator('span, generic').last();
      await expect(amountToPayLocator).toBeVisible({ timeout: 15000 });
      
      const amountRaw = await amountToPayLocator.innerText();
      const amountToPay = amountRaw.replace(/[^0-9.]/g, '').trim();
      console.log(`✅ Current balance for payment: ${amountToPay}`);

      if (parseFloat(amountToPay) === 0) {
        console.log("ℹ️ Ticket has 0 balance, skipping payment portal verification.");
      } else {
        console.log("⏳ Opening payment portal...");
        const [paymentPage] = await Promise.all([
          page.context().waitForEvent('page', { timeout: 30000 }),
          page.locator('button:has-text("לתשלום")').first().click(),
        ]);

        await paymentPage.waitForLoadState('load');
        
        const showAmountBtn = paymentPage.locator('button[aria-label="הצג סכום"]');
        await showAmountBtn.click();
        
        await expect(paymentPage.locator('label#sumResult')).toContainText(amountToPay, { timeout: 20000 });
        console.log("✅ Payment portal matches amount.");
        await paymentPage.close();
      }
    }
  } catch (e) {
    console.error("❌ Error in Unpaid Tickets:", (e as Error).message);
    hasErrors = true;
    errorSummary.push("Unpaid Tickets");
  }

  try {
    console.log("🔍 Checking Paid Tickets history...");
    const paidTab = page.locator('button[role="tab"]:has-text("דוחות ששולמו"), a:has-text("דוחות ששולמו")');
    await paidTab.click();
    
    const paidItem = page.locator('div[role="button"].toggle-list-item').first();
    const noPaidData = page.getByText('אין נתונים').or(page.getByText('לא נמצאו דוחות'));

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