import { test, expect } from './fixtures';
import { trackPageErrors } from './helpers';
import { sql } from './db';

// Appointments: add a job for a customer from the calendar page; it is stored with the
// customer, the site and the default 09:00–10:00 slot of the chosen day.
test('เพิ่มนัดหมายให้ลูกค้า แล้วบันทึกลงฐานข้อมูล', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'writes data: Chromium only');
  const health = trackPageErrors(page);
  const title = `ส่งนั่งร้าน E2E ${Date.now()}`;

  await page.goto('/appointments');
  await page.getByRole('button', { name: 'เพิ่มนัดหมาย' }).first().click();
  await page.locator('#apt-title').fill(title);
  await page.getByPlaceholder('พิมพ์ค้นหาชื่อลูกค้า, บริษัท, เบอร์โทร...').fill('ลูกค้า E2E');
  await page.getByRole('button', { name: /ลูกค้า E2E \d+/ }).first().click();
  await page.locator('#apt-location').fill('ไซต์งาน E2E บางพลี');
  await page.getByRole('button', { name: 'บันทึกการนัดหมาย' }).click();
  await expect(page.getByText('บันทึกการนัดหมายสำเร็จ')).toBeVisible({ timeout: 20000 });

  const [row] = sql(`select customer_id is not null, location, to_char(start_datetime at time zone 'Asia/Bangkok', 'HH24:MI'),
    to_char(end_datetime at time zone 'Asia/Bangkok', 'HH24:MI'), status from public.appointments where title = '${title}'`);
  expect(row?.slice(0, 4)).toEqual(['t', 'ไซต์งาน E2E บางพลี', '09:00', '10:00']);
  health.expectNone();
});

test('นัดหมายต้องมีชื่องาน: ไม่กรอกชื่อจะบันทึกไม่ได้', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'writes data: Chromium only');
  const before = sql('select count(*) from public.appointments')[0][0];
  await page.goto('/appointments');
  await page.getByRole('button', { name: 'เพิ่มนัดหมาย' }).first().click();
  const save = page.getByRole('button', { name: 'บันทึกการนัดหมาย' });
  await save.click();
  // Blocked either by the browser's required-field check or by the app's own message.
  await page.waitForTimeout(1500);
  await expect(save).toBeVisible();
  expect(sql('select count(*) from public.appointments')[0][0]).toBe(before);
});
