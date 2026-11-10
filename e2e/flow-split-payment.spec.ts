import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { billByNo, sql } from './db';
import { confirmCashAsIs, issuedBillNo } from './helpers';

// เงินสด + QR Code in one payment (owner 2026-11-06): press both buttons in the order the customer pays.
// เงินสด → QR Code: type the cash → ยืนยัน → the QR for the rest → ได้รับเงินแล้ว.
// QR Code → เงินสด: the QR first (type the transfer) → ได้รับเงินแล้ว → the cash for the rest → ยืนยัน.
// Local Supabase only.
const PRODUCT = 'นั่งร้าน 1.70(ชุด)';

test.describe.configure({ mode: 'serial' });

/** POS: rent 2 sets (30 บาท) to a new customer and go to the payment page. */
async function rentToCheckout(page: Page, tag: string) {
  await page.goto('/pos');
  await page.getByRole('button', { name: 'เช่าสินค้า' }).click();
  await page.getByRole('heading', { name: PRODUCT, level: 4 }).click();
  const add = page.getByRole('dialog').filter({ hasText: 'จำนวนที่ต้องการ' });
  await add.getByRole('textbox', { name: '1' }).first().fill('2');
  await add.getByRole('button', { name: 'เพิ่มลงตะกร้า' }).click();
  const stamp = Date.now();
  await page.getByRole('button', { name: 'เพิ่มลูกค้า', exact: true }).click();
  const form = page.getByRole('dialog').filter({ hasText: 'บันทึกข้อมูลลูกค้าใหม่' });
  await form.getByLabel('ชื่อลูกค้า / ชื่อบริษัท').fill(`ลูกค้า ${tag} ${stamp}`);
  await form.getByLabel('เบอร์โทรศัพท์หลัก').fill('07' + String(stamp).slice(-8));
  await form.getByLabel('บ้านเลขที่').fill('7');
  await form.getByRole('button', { name: 'บันทึกข้อมูลลูกค้า' }).click();
  await expect(page.getByRole('heading', { name: 'เพิ่มลูกค้าสำเร็จ' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'ชำระเงิน' }).click();
  await page.waitForURL('**/pos/checkout');
}

const paymentsOf = (billNo: string) =>
  sql(`select p.method, p.amount from public.payments p join public.bills b on b.id = p.bill_id
    where b.bill_no = '${billNo}' and p.status = 'COMPLETED' order by p.method`).map(([m, a]) => [m, Number(a)]);

let unpaidBill = '';

test('หน้าชำระเงิน: เงินสด 10 ก่อน → QR Code กลางจอ 20 ที่เหลือ → บิลชำระครบ 2 ช่องทาง', async ({ page }) => {
  await rentToCheckout(page, 'สด+QR');
  await page.getByRole('button', { name: 'เงินสด', exact: true }).click();
  await page.getByRole('button', { name: 'QR Code', exact: true }).click();
  await expect(page.getByText('จ่าย 2 ช่องทาง: เงินสดก่อน แล้วต่อด้วย QR Code')).toBeVisible();
  // cash 10 → ยืนยัน → ถูกต้อง: the screen moves on to the QR for the rest
  const cash = page.locator('div').filter({ has: page.getByText('เงินสดที่รับมา (บาท)', { exact: true }) }).last();
  await cash.getByRole('textbox').first().fill('10');
  await cash.getByRole('button', { name: 'ยืนยัน', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('ส่วนที่เหลือ 20.00 บาท จ่ายด้วย QR Code');
  await page.getByRole('alertdialog').getByRole('button', { name: 'ถูกต้อง' }).click();
  const qr = page.getByRole('dialog', { name: 'สแกนจ่ายด้วย QR Code' });
  await expect(qr.getByText('20.00 บาท')).toBeVisible();
  await qr.getByRole('button', { name: 'ได้รับเงินแล้ว' }).click();
  await page.getByRole('button', { name: 'ออกบิล' }).click();
  const billNo = await issuedBillNo(page);
  expect(billByNo(billNo)).toMatchObject({ paymentStatus: 'PAID', paid: 30, balance: 0 });
  expect(paymentsOf(billNo)).toEqual([['CASH', 10], ['QR', 20]]);
});

test('ออกบิลค้างชำระไว้ก่อน (สำหรับทดสอบหน้าจัดการบิล)', async ({ page }) => {
  await rentToCheckout(page, 'QR+สด');
  await page.getByRole('button', { name: 'ค้างชำระ' }).click();
  await page.getByRole('button', { name: 'ออกบิล' }).click();
  unpaidBill = await issuedBillNo(page);
  expect(billByNo(unpaidBill)).toMatchObject({ paymentStatus: 'UNPAID', balance: 30 });
});

test('หน้าจัดการบิล: QR Code ก่อน โอน 10 → เงินสดรับส่วนที่เหลือ 20 → ชำระครบ', async ({ page }) => {
  test.skip(!unpaidBill, 'needs the unpaid bill');
  await page.goto('/bills');
  await page.getByRole('row', { name: new RegExp(unpaidBill) }).click();
  await page.getByRole('button', { name: 'จัดการบิล' }).click();
  await page.getByRole('button', { name: 'ถัดไป' }).click();
  await expect(page.getByRole('heading', { name: 'สรุปยอดและรับชำระเงิน' })).toBeVisible();
  await page.getByRole('button', { name: 'QR Code' }).click();
  const qr = page.getByRole('dialog', { name: 'สแกนจ่ายด้วย QR Code' });
  await expect(qr.getByText('30.00 บาท')).toBeVisible();
  await qr.getByRole('button', { name: 'ปิด', exact: true }).click();
  // then เงินสด: the QR comes back first, now with a box for the transfer
  await page.getByRole('button', { name: 'เงินสด', exact: true }).click();
  await qr.getByRole('textbox', { name: 'ยอดที่ลูกค้าโอน' }).fill('10');
  await expect(qr.getByText('ส่วนที่เหลือ 20.00 บาท รับต่อด้วยเงินสด')).toBeVisible();
  await qr.getByRole('button', { name: 'ได้รับเงินแล้ว' }).click();
  await expect(page.getByText(/รับแล้ว: QR Code/)).toBeVisible();
  await confirmCashAsIs(page);
  await page.getByRole('button', { name: 'ออกบิล', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'บันทึกรับชำระเงินสำเร็จ' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('dialog').getByRole('button', { name: 'ออก' }).click();
  expect(billByNo(unpaidBill)).toMatchObject({ paymentStatus: 'PAID', paid: 30, balance: 0 });
  expect(paymentsOf(unpaidBill)).toEqual([['CASH', 20], ['QR', 10]]);
});
