import { test as setup, expect } from '@playwright/test';
import { login, typePin, OWNER_STATE } from './helpers';

// Logs the owner in once, makes sure the account has a PIN, and saves the session for the
// other specs. Feature list: 2 (login), 7 (set PIN).
setup('owner signs in and has a PIN', async ({ page }) => {
  await login(page);
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));

  await page.goto('/settings/security');
  const lockCard = page.getByRole('heading', { name: 'PIN สำหรับล็อก/ปลดล็อกหน้าจอ' });
  await expect(lockCard).toBeVisible({ timeout: 20000 });
  const setPin = page.getByRole('button', { name: 'ตั้ง PIN' }).first();
  if (await setPin.isVisible()) {
    await setPin.click();
    const dialog = page.getByRole('dialog', { name: 'ตั้ง PIN' });
    await typePin(dialog);
    await typePin(page.getByRole('dialog', { name: 'ยืนยัน PIN' }));
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15000 });
  }
  await expect(page.getByText('ยังไม่ได้ตั้ง')).toHaveCount(0);
  await page.context().storageState({ path: OWNER_STATE });
});
