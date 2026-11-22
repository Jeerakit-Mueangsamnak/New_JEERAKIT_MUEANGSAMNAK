import { test, expect } from './fixtures';
import { sql } from './db';
import { login } from './helpers';

// เมนู LINE (owner 2026-11-21): three pages with a menu each, on an iPad held upright; deciding a request;
// the product list ticks; the registration settings; the chat menus (trial mode: nothing is published).
// Local database only. Chromium only (writes data).
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'chromium', 'writes data: Chromium only');
});
// Own sign-in (the owner has no PIN on a fresh local database): the shared auth.setup is not needed for these pages.
test.use({ viewport: { width: 820, height: 1180 }, storageState: { cookies: [], origins: [] } });
test.beforeEach(async ({ page }) => {
  await login(page);
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
});

const U = (n: number) => 'U' + String(n).repeat(32);
// a new phone each run: customers are never deleted, so an old run's customer would still hold it
const PHONE = `0899${String(Date.now()).slice(-6)}`;
const NAME = { stranger: 'E2E คนแปลกหน้า', request: 'E2E ผู้ขอลงทะเบียน', blocked: 'E2E คนบล็อก' };

function cleanup() {
  sql(`delete from public.line_deliveries where contact_id in (select id from public.line_contacts where display_name like 'E2E %')`);
  sql(`delete from public.line_contacts where display_name like 'E2E %'`);
  sql(`update public.products set line_listed = false where line_listed`);
  sql(`update public.product_categories set line_listed = false, line_order = 0 where line_listed or line_order <> 0`);
  sql(`update public.store_settings set policies = policies #- '{line,register}' #- '{line,catalog}'`);
}

test.beforeAll(() => {
  cleanup();
  sql(`insert into public.line_contacts (line_user_id, followed, followed_at, display_name, status, register_status, typed_name, typed_phone, register_payload) values
    ('${U(1)}', true, now(), '${NAME.stranger}', 'UNLINKED', 'WAITING', null, null, '{}'),
    ('${U(2)}', true, now(), '${NAME.request}', 'UNLINKED', 'PENDING', 'ลูกค้า อีทูอี', '${PHONE}',
        '{"match":"NONE","channel":"FORM","address":{"province":"อุตรดิตถ์","postcode":"53000"},"submitted_at":"2026-11-21T01:00:00Z"}'),
    ('${U(3)}', false, now(), '${NAME.blocked}', 'UNLINKED', null, null, null, '{}')`);
});
test.afterAll(() => {
  cleanup();
  // customers are never deleted (the database refuses): the one this run made is switched off
  sql(`update public.customers set active = false where phone = '${PHONE}'`);
});

const tabs = (page: import('@playwright/test').Page) => page.getByRole('tablist', { name: 'เมนู LINE' });

test('หน้า LINE บน iPad แนวตั้ง: 3 หน้า เมนูซ้าย ไม่ล้นจอ และไม่มี error', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/line');
  await expect(tabs(page).getByRole('tab')).toHaveCount(3, { timeout: 30000 });
  await expect(page.getByRole('tablist', { name: 'เพิ่มเพื่อนและจัดการบัญชี LINE' })).toBeVisible();
  for (const group of ['เพิ่มเพื่อนและจัดการบัญชี LINE', 'แก้ไขข้อความ', 'ตั้งค่า']) {
    await tabs(page).getByRole('tab', { name: new RegExp(`^${group}`) }).click();
    await expect(page.getByRole('tablist', { name: group })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${group}: no sideways scroll`).toBeLessThanOrEqual(1);
    const shot = await page.screenshot({ path: process.env.LINE_SHOTS ? `${process.env.LINE_SHOTS}/line-${group.slice(0, 4)}.png` : undefined });
    await info.attach(`line-${group}`, { body: shot, contentType: 'image/png' });
  }
  expect(errors).toEqual([]);
});

test('รายการแสดงคนที่เพิ่มเพื่อนด้วยสถานะแยกกัน และดูรายละเอียดได้', async ({ page }) => {
  await page.goto('/line');
  await page.getByRole('tab', { name: 'เพื่อนทั้งหมด' }).click();
  const table = page.getByTestId('line-people-ALL');
  await expect(table.getByText(NAME.request)).toBeVisible({ timeout: 30000 });
  const row = table.getByRole('row').filter({ hasText: NAME.request });
  await expect(row.getByText('รอร้านตรวจสอบ')).toBeVisible();
  await expect(row.getByText('บุคคลทั่วไป')).toBeVisible();
  await expect(table.getByRole('row').filter({ hasText: NAME.blocked }).getByText('ยังไม่เป็นเพื่อน')).toHaveCount(0); // added the OA, then blocked it
  await expect(table.getByRole('row').filter({ hasText: NAME.blocked }).getByText('บล็อก/ลบ LINE ร้าน')).toBeVisible();
  await row.getByRole('button', { name: 'ดูรายละเอียด' }).click();
  await expect(page.getByText('ไม่พบเบอร์นี้ในลูกค้าเดิม')).toBeVisible();
  await expect(page.getByText('จ.อุตรดิตถ์', { exact: false })).toBeVisible(); // the address from the form
});

test('อนุมัติคำขอ: สร้างลูกค้าใหม่ ผูก LINE และแจ้งผู้ลงทะเบียน (ในโหมดทดลองแค่เข้าคิว)', async ({ page }) => {
  await page.goto('/line');
  await page.getByRole('tab', { name: 'รอร้านตรวจสอบ' }).click();
  const table = page.getByTestId('line-people-PENDING');
  await table.getByRole('row').filter({ hasText: NAME.request }).getByRole('button', { name: 'ดูรายละเอียด' }).click();
  await page.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
  await page.getByRole('button', { name: 'อนุมัติและสร้างลูกค้า' }).click();
  await expect(page.getByText('อนุมัติและสร้างลูกค้าแล้ว')).toBeVisible({ timeout: 20000 });
  const [contact] = sql(`select status, register_status is null, customer_id is not null from public.line_contacts where display_name = '${NAME.request}'`);
  expect(contact).toEqual(['LINKED', 't', 't']);
  const [customer] = sql(`select name, address from public.customers where phone = '${PHONE}'`);
  expect(customer[0]).toBe('ลูกค้า อีทูอี');
  expect(customer[1]).toContain('อุตรดิตถ์');
  // the person is told in their own chat: one REGISTER row in the outbox (not pushed in the trial mode)
  expect(sql(`select count(*) from public.line_deliveries d join public.line_contacts c on c.id = d.contact_id where c.display_name = '${NAME.request}' and d.source_type = 'REGISTER' and d.template_key = 'REGISTER_APPROVED'`)[0][0]).toBe('1');
});

test('ปฏิเสธต้องใส่เหตุผล และไม่ผูกกับใคร', async ({ page }) => {
  await page.goto('/line');
  await page.getByRole('tab', { name: 'ยังไม่ลงทะเบียน' }).click();
  await page.getByTestId('line-people-UNREG').getByRole('row').filter({ hasText: NAME.stranger }).getByRole('button', { name: 'ดูรายละเอียด' }).click();
  await page.getByRole('button', { name: 'ปฏิเสธ', exact: true }).click();
  const confirm = page.getByRole('button', { name: 'ปฏิเสธ', exact: true }).last();
  await expect(confirm).toBeDisabled();
  await page.getByLabel('เหตุผลที่ปฏิเสธ').fill('ไม่ใช่ลูกค้าของร้าน');
  await confirm.click();
  await expect(page.getByText('ปฏิเสธแล้ว')).toBeVisible({ timeout: 20000 });
  expect(sql(`select register_status, register_note, customer_id is null from public.line_contacts where display_name = '${NAME.stranger}'`)[0]).toEqual(['REJECTED', 'ไม่ใช่ลูกค้าของร้าน', 't']);
});

test('ตั้งค่า › การลงทะเบียน: เลือกช่องที่ต้องกรอกแล้วบันทึก อยู่ในฐานข้อมูล', async ({ page }) => {
  await page.goto('/line');
  await tabs(page).getByRole('tab', { name: /^ตั้งค่า/ }).click();
  await page.getByRole('tab', { name: 'การลงทะเบียน' }).click();
  await page.getByLabel('ต้องกรอกจังหวัด').check({ force: true });
  await page.getByRole('button', { name: 'บันทึกการตั้งค่า', exact: true }).click();
  await expect(page.getByText('บันทึกแล้ว', { exact: true })).toBeVisible({ timeout: 20000 });
  expect(sql(`select policies->'line'->'register'->'required'->>'province' from public.store_settings where singleton`)[0][0]).toBe('true');
});

test('ตั้งค่า › รายการสินค้า: ติ๊กทั้งหมวด และเปิดราคา แล้วอยู่ในฐานข้อมูล', async ({ page }) => {
  await page.goto('/line');
  await tabs(page).getByRole('tab', { name: /^ตั้งค่า/ }).click();
  await page.getByRole('tab', { name: 'รายการสินค้า' }).click();
  const first = page.getByRole('button', { expanded: false }).first();
  await expect(first).toBeVisible({ timeout: 30000 });
  await first.click();
  await page.getByRole('button', { name: 'เลือกทั้งหมวด' }).click();
  await expect.poll(() => Number(sql(`select count(*) from public.products where line_listed`)[0][0]), { timeout: 20000 }).toBeGreaterThan(0);
  expect(sql(`select count(*) from public.product_categories where line_listed`)[0][0]).toBe('0'); // the category itself is a separate tick
  await page.getByLabel('แสดงราคาในรายการสินค้า').check({ force: true });
  await page.getByRole('button', { name: 'บันทึกการตั้งค่า', exact: true }).click();
  await expect(page.getByText('บันทึกแล้ว', { exact: true })).toBeVisible({ timeout: 20000 });
  expect(sql(`select policies->'line'->'catalog'->>'showPrice' from public.store_settings where singleton`)[0][0]).toBe('true');
});

test('ตั้งค่า › เมนู LINE: เห็นเมนู 4 แบบ ในโหมดทดลองเผยแพร่ไม่ได้', async ({ page }) => {
  await page.goto('/line');
  await tabs(page).getByRole('tab', { name: /^ตั้งค่า/ }).click();
  await page.getByRole('tab', { name: 'เมนู LINE' }).click();
  await expect(page.getByTestId('line-menu-mock')).toBeVisible({ timeout: 30000 });
  await expect(page.getByAltText(/ตัวอย่างเมนู/)).toHaveCount(4);
  for (const b of await page.getByRole('button', { name: /เผยแพร่เมนูนี้/ }).all()) await expect(b).toBeDisabled();
});
