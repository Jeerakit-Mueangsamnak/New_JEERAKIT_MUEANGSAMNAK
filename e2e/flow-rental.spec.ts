import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { billByNo, stockBySku } from './db';

// Rental from stock receiving to the last item returned, checked on screen and in the database.
// Feature list: 90-91 + 98 (stock receive), 76 (add customer), 23-24, 26-31, 35, 39, 41,
// 47 (hand over now), 49-52 (return / partial / inspect / damaged), 62 (bill closes), 97.
const SKU = 'NR-001';
const PRODUCT = 'นั่งร้าน 1.70(ชุด)';
const RECEIVE = 10;
const RENT = 5;

test.describe.configure({ mode: 'serial' });

let billNo = '';
let before: Record<string, number> = {};

async function openProduct(page: Page) {
  await page.goto('/products');
  await page.getByRole('row', { name: new RegExp(`^${PRODUCT.replace(/[().]/g, '\\$&')}`) })
    .getByRole('button', { name: 'ดูข้อมูลและประวัติการเช่า' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: PRODUCT, level: 3 })).toBeVisible();
  return dialog;
}

test('รับสินค้าเข้าสต็อกจากหน้าแก้ไขสินค้า (ไม่ถาม PIN)', async ({ page }) => {
  before = stockBySku(SKU);
  const total = Object.values(before).reduce((a, b) => a + b, 0);
  const dialog = await openProduct(page);
  await dialog.getByRole('button', { name: 'แก้ไขสินค้า' }).click();
  const qty = dialog.locator('div').filter({ has: page.locator('label', { hasText: 'จำนวนทั้งหมด' }) }).last().locator('input');
  await qty.fill(String(total + RECEIVE));
  await dialog.getByRole('button', { name: 'บันทึก', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'บันทึกสำเร็จ' })).toBeVisible({ timeout: 20000 });
  expect(stockBySku(SKU).AVAILABLE).toBe((before.AVAILABLE ?? 0) + RECEIVE);
});

test('เช่าสินค้า: ลูกค้าใหม่ + เงินสด + ส่งมอบทันที ออกบิลได้', async ({ page }) => {
  const start = stockBySku(SKU);
  await page.goto('/pos');
  await page.getByRole('button', { name: 'เช่าสินค้า' }).click();
  await page.getByRole('heading', { name: PRODUCT, level: 4 }).click();
  const add = page.getByRole('dialog').filter({ hasText: 'จำนวนที่ต้องการ' });
  await add.getByRole('textbox', { name: '1' }).first().fill(String(RENT));
  await add.getByRole('button', { name: 'เพิ่มลงตะกร้า' }).click();
  await expect(page.getByText(`15 บาท × ${RENT} ชุด × 1 รอบ`)).toBeVisible();

  // A rental needs a registered customer, not a walk-in guest.
  const stamp = Date.now();
  await page.getByRole('button', { name: 'เพิ่มลูกค้า', exact: true }).click();
  const form = page.getByRole('dialog').filter({ hasText: 'บันทึกข้อมูลลูกค้าใหม่' });
  await form.getByLabel('ชื่อลูกค้า / ชื่อบริษัท').fill(`ลูกค้า E2E ${stamp}`);
  await form.getByLabel('เบอร์โทรศัพท์หลัก').fill('08' + String(stamp).slice(-8));
  // No address typed: the form asks for one instead of saving a made-up address.
  await form.getByRole('button', { name: 'บันทึกข้อมูลลูกค้า' }).click();
  await expect(form.getByRole('alert').filter({ hasText: 'กรุณากรอกที่อยู่' })).toBeVisible();
  await form.getByLabel('บ้านเลขที่').fill('12');
  await form.getByRole('button', { name: 'บันทึกข้อมูลลูกค้า' }).click();
  await expect(page.getByRole('heading', { name: 'เพิ่มลูกค้าสำเร็จ' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ไม่สามารถเพิ่มลูกค้าได้' })).toHaveCount(0);

  await expect(page.getByText('ยอดสุทธิที่ต้องชำระ')).toBeVisible();
  await page.getByRole('button', { name: 'ชำระเงิน' }).click();
  await page.waitForURL('**/pos/checkout');
  // Never invent values: no address the user did not type, no sample shop or bank account.
  await expect(page.getByText(`ลูกค้า E2E ${stamp}`).first()).toBeVisible();
  for (const made_up of ['ลาดยาว', '012-3-45678-9', 'อุปกรณ์เช่ามาตรฐาน']) {
    await expect(page.getByText(made_up)).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'เงินสด' }).click();
  await expect(page.getByRole('checkbox', { name: /ลูกค้ารับของเลย/ })).toBeChecked();
  await page.getByRole('button', { name: 'ออกบิล' }).click();

  const done = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'บันทึกบิลเช่าสำเร็จ' }) });
  await expect(done).toBeVisible({ timeout: 20000 });
  billNo = (await done.innerText()).match(/BL-\d{8}-\d{3}/)?.[0] ?? '';
  expect(billNo).not.toBe('');
  await done.getByRole('button', { name: 'ออก' }).click();

  expect(billByNo(billNo)).toEqual({ status: 'ACTIVE', paymentStatus: 'PAID', grandTotal: 75, paid: 75, balance: 0 });
  const after = stockBySku(SKU);
  expect(after.AVAILABLE).toBe(start.AVAILABLE - RENT);
  expect(after.RENTED_OUT).toBe((start.RENTED_OUT ?? 0) + RENT);
});

async function startReturn(page: Page) {
  await page.goto('/bills');
  await page.getByRole('row', { name: new RegExp(billNo) }).click();
  await page.getByRole('button', { name: 'รับคืนสินค้า' }).click();
  await page.getByRole('checkbox', { name: 'เลือก/ยกเลิกทั้งหมด' }).check();
  await page.getByRole('button', { name: 'ถัดไป' }).click();
  return page.getByRole('row', { name: new RegExp(`${PRODUCT.replace(/[().]/g, '\\$&')} ${SKU}`) });
}

test('รับคืนบางส่วน: ปกติ 3 ชำรุด 1 — บิลยังเปิดอยู่', async ({ page }) => {
  test.skip(!billNo, 'needs the bill from the previous step');
  const start = stockBySku(SKU);
  const row = await startReturn(page);
  await row.getByRole('textbox').nth(0).fill('3');
  await row.getByRole('textbox').nth(1).fill('1');
  await page.getByRole('button', { name: 'ถัดไป' }).click();
  await expect(page.getByRole('heading', { name: 'สรุปยอดและรับชำระเงิน' })).toBeVisible();
  await page.getByRole('button', { name: 'บันทึก', exact: true }).click();
  const done = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'บันทึกรับคืนสินค้าสำเร็จ' }) });
  await expect(done).toBeVisible({ timeout: 20000 });
  await done.getByRole('button', { name: 'ออก' }).click();

  const after = stockBySku(SKU);
  expect(after.AVAILABLE).toBe(start.AVAILABLE + 3);
  expect(after.DAMAGED).toBe((start.DAMAGED ?? 0) + 1);
  expect(after.RENTED_OUT).toBe(start.RENTED_OUT - 4);
  expect(billByNo(billNo)?.status).toBe('ACTIVE');
});

test('รับคืนชิ้นสุดท้าย — บิลปิด', async ({ page }) => {
  test.skip(!billNo, 'needs the bill from the previous step');
  const start = stockBySku(SKU);
  const row = await startReturn(page);
  await row.getByRole('textbox').nth(0).fill('1');
  await page.getByRole('button', { name: 'ถัดไป' }).click();
  await page.getByRole('button', { name: 'บันทึก', exact: true }).click();
  const done = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'บันทึกรับคืนสินค้าสำเร็จ' }) });
  await expect(done).toBeVisible({ timeout: 20000 });
  await done.getByRole('button', { name: 'ออก' }).click();

  expect(stockBySku(SKU).AVAILABLE).toBe(start.AVAILABLE + 1);
  expect(billByNo(billNo)?.status).toBe('CLOSED');
});
