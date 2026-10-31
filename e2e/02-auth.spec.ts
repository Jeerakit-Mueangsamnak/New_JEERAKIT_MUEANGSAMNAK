import { test, expect } from './fixtures';
import { login, OWNER } from './helpers';

// Feature list: 2 (login), 3 (logout).
test.describe('เข้าสู่ระบบ / ออกจากระบบ', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('หน้าเข้าสู่ระบบแสดงช่องกรอกครบ', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByPlaceholder('Username')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('รหัสผ่านผิด เข้าไม่ได้ และแจ้งเตือน', async ({ page }) => {
    await login(page, OWNER.username, 'wrong-password-1');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('form').locator('..').getByText(/ไม่ถูกต้อง|ผิด/)).toBeVisible();
  });

  test('เข้าสู่ระบบแล้วออกจากระบบ', async ({ page }) => {
    await login(page);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30000 });
    await expect(page).not.toHaveURL(/\/login/);
    await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
    await page.goto('/bills');
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
  });
});
