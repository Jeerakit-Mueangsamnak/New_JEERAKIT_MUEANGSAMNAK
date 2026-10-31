import type { Browser, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { login } from './helpers';
import { sql } from './db';

// Staff: signs up alone → cannot get in until the owner approves → owner gives only the POS and
// bills menus → staff sees just those menus and is sent away from a page it was not given.
test.describe.configure({ mode: 'serial' });

const stamp = Date.now();
const STAFF = { username: `staff_e2e_${stamp}`, password: 'StaffE2E-Pass!2026', email: `staff_e2e_${stamp}@example.com` };
const staffStatus = () => sql(`select status from public.profiles where username = '${STAFF.username}'`)[0]?.[0];

/** The staff row on จัดการสิทธิ์; presses รีเฟรช once if the first load came back empty. */
async function staffRow(page: Page) {
  await page.goto('/owner-permissions');
  const row = page.getByRole('row', { name: new RegExp(STAFF.username) });
  try {
    await expect(row).toBeVisible({ timeout: 10000 });
  } catch {
    await page.getByTitle('รีเฟรชข้อมูล').click();
    await expect(row).toBeVisible({ timeout: 15000 });
  }
  return row;
}

async function staffPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  return context.newPage();
}

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'chromium', 'creates users: Chromium only');
});

test('พนักงานสมัครเอง: ยังเข้าใช้ไม่ได้จนกว่าเจ้าของร้านอนุมัติ', async ({ browser }) => {
  const page = await staffPage(browser);
  await page.goto('/register');
  await page.getByPlaceholder('สมชาย').fill('พนักงาน');
  await page.getByPlaceholder('ใจดี').fill('ทดสอบ');
  await page.getByPlaceholder('somchai@example.com').fill(STAFF.email);
  await page.getByPlaceholder('somchai_pos').fill(STAFF.username);
  await page.getByPlaceholder('อย่างน้อย 12 ตัวอักษร').fill(STAFF.password);
  await page.getByPlaceholder('กรอกรหัสผ่านซ้ำ').fill(STAFF.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/login?registered=1', { timeout: 20000 });
  expect(staffStatus()).toBe('PENDING');

  await login(page, STAFF.username, STAFF.password);
  await page.waitForTimeout(3000);
  expect(new URL(page.url()).pathname).toBe('/login');
  await page.context().close();
});

// Owner 2026-10-26 (Master §4.2): an approved member uses every menu — no per-person ticks —
// while member management (จัดการสิทธิ์) stays with the OWNER.
test('เจ้าของร้านอนุมัติ แล้วไม่มีช่องติ๊กสิทธิ์รายคนอีก', async ({ page }) => {
  const row = await staffRow(page);
  await row.getByRole('button', { name: 'อนุมัติ' }).click();
  await expect.poll(staffStatus, { timeout: 20000 }).toBe('ACTIVE');

  await row.getByText('พนักงาน ทดสอบ').click();
  await expect(page.getByRole('checkbox', { name: /ให้สิทธิ์/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'บันทึกสิทธิ์' })).toHaveCount(0);
});

test('พนักงานที่อนุมัติแล้วใช้ได้ทุกเมนู รวมตั้งค่าระบบ แต่เปิดจัดการสิทธิ์ไม่ได้', async ({ browser }) => {
  const page = await staffPage(browser);
  await login(page, STAFF.username, STAFF.password);
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });

  const nav = page.locator('aside, nav').first();
  for (const shown of ['หน้าร้าน POS', 'จัดการบิลเช่า', 'การเงิน', 'สินค้า / สต็อก', 'ตั้งค่าระบบ']) {
    await expect(nav.getByRole('link', { name: shown, exact: true })).toBeVisible();
  }
  await expect(nav.getByRole('link', { name: 'จัดการสิทธิ์ & รายงาน', exact: true })).toHaveCount(0);

  await page.goto('/finance/statement');
  await expect(page).toHaveURL(/\/finance\/statement/);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/settings/);
  await expect(page.getByText('ตั้งค่าระบบเปิดได้เฉพาะเจ้าของร้าน')).toHaveCount(0);
  await page.goto('/owner-permissions');
  await page.waitForURL((u) => u.pathname !== '/owner-permissions', { timeout: 20000 });
  await page.context().close();
});

test('ระงับพนักงาน: เข้าระบบไม่ได้อีก', async ({ page, browser }) => {
  await (await staffRow(page)).getByRole('button', { name: 'ระงับ' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'ยืนยัน', exact: true }).click();
  await expect.poll(staffStatus, { timeout: 20000 }).toBe('SUSPENDED');

  const staff = await staffPage(browser);
  await login(staff, STAFF.username, STAFF.password);
  await staff.waitForTimeout(3000);
  expect(new URL(staff.url()).pathname).toBe('/login');
  await staff.context().close();
});
