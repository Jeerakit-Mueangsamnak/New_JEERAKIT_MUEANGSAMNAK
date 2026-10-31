import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { sql } from './db';

// Settings › กิจการ is saved to the database and survives a reload; Settings › LINE shows the
// test (mock) delivery mode on this machine; the public LINE endpoints refuse strangers.
const field = (page: Page, label: string) =>
  page.locator('div').filter({ has: page.locator('label', { hasText: label }) }).last().locator('input').first();

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'chromium', 'writes settings: Chromium only');
});

test('ตั้งค่ากิจการ: บันทึกชื่อร้านและเบอร์โทร แล้วโหลดใหม่ยังอยู่', async ({ page }) => {
  const phone = `02-${String(Date.now()).slice(-7)}`;
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'ตั้งค่าระบบ' })).toBeVisible({ timeout: 20000 });
  await field(page, 'ชื่อกิจการ / ร้านค้า').fill('ร้านเช่านั่งร้าน E2E');
  await field(page, 'เบอร์โทรศัพท์').fill(phone);
  await page.getByRole('button', { name: 'บันทึก', exact: true }).click();
  await expect(page.getByText('บันทึกแล้ว', { exact: true })).toBeVisible({ timeout: 20000 });
  expect(sql('select company_name, phone from public.store_settings where singleton')[0]).toEqual(['ร้านเช่านั่งร้าน E2E', phone]);

  await page.reload();
  await expect(field(page, 'เบอร์โทรศัพท์')).toHaveValue(phone, { timeout: 20000 });
});

test('ตั้งค่ากิจการ: ไม่ใส่ชื่อร้านจะบันทึกไม่ได้', async ({ page }) => {
  await page.goto('/settings');
  const name = field(page, 'ชื่อกิจการ / ร้านค้า');
  await expect(name).toBeVisible({ timeout: 20000 });
  const before = sql('select company_name from public.store_settings where singleton')[0][0];
  await name.fill('');
  const save = page.getByRole('button', { name: 'บันทึก', exact: true });
  if (await save.isEnabled()) await save.click();
  await page.waitForTimeout(1500);
  expect(sql('select company_name from public.store_settings where singleton')[0][0]).toBe(before);
});

test('ตั้งค่า LINE: เปิดจากลิงก์ ?tab=line และแสดงโหมดทดสอบ (ไม่ส่งถึง LINE จริง)', async ({ page }) => {
  await page.goto('/settings?tab=line');
  await page.getByRole('tab', { name: 'เชื่อมต่อ LINE OA' }).click();
  await expect(page.getByText('ทดสอบ (ไม่ส่งถึง LINE จริง)')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('input[readonly][value$="/api/line/webhook"]')).toHaveCount(1);
});

test('LINE webhook และงานส่งข้อความ ปฏิเสธคนที่ไม่มีลายเซ็น/รหัสลับ', async ({ request }) => {
  // 401 = bad signature; 503 = no channel secret set on this machine yet. Never 200.
  const webhook = await request.post('/api/line/webhook', { data: { destination: 'x', events: [] } });
  expect([401, 503]).toContain(webhook.status());

  for (const path of ['/api/line/cron', '/api/line/outbox']) {
    const res = await request.post(path, { headers: { authorization: 'Bearer wrong-secret-wrong-secret-wrong-secret' } });
    expect([401, 503]).toContain(res.status());
  }
});
