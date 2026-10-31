import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { amountBox, issuedBillNo } from './helpers';
import { billByNo, sql, stockBySku } from './db';

// Money: sale, credit bill with deposit, partial and split payments, refund, continuation.
// Feature list: 94 (sale price), 23, 32-36, 57, 59, 60, 56.
// Owner decision 2026-10-22: actions ask no PIN and no reason; rights are checked by the server
// and every change is written to the audit log.
// Not here: 58 (void a payment) has no button in the app yet.
const SALE_SKU = 'NR-004';
const SALE_PRODUCT = 'ขาปรับระดับ';
const RENT_PRODUCT = 'นั่งร้าน 1.70(ชุด)';

test.describe.configure({ mode: 'serial' });

let creditBill = '';

test('แก้ราคาขายและรับเข้าสต็อก: บันทึกทันที ไม่ถาม PIN ไม่ถามเหตุผล', async ({ page }) => {
  // Alternate 50 / 55 so every run really changes the price.
  const [[current]] = sql(`select coalesce(sale_price::text, '') from public.products where sku = '${SALE_SKU}'`);
  const next = current === '50.00' ? '55' : '50';
  const availableBefore = stockBySku(SALE_SKU).AVAILABLE ?? 0;
  await page.goto('/products');
  await page.getByRole('row', { name: new RegExp(`^${SALE_PRODUCT}`) }).getByRole('button', { name: 'ดูข้อมูลและประวัติการเช่า' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'แก้ไขสินค้า' }).click();
  await dialog.getByPlaceholder('เว้นว่างได้ถ้าไม่ขาย').fill(next);
  // The form's total counts stock the shop still owns (sold units are not in it): add 10 to what it shows.
  const qty = dialog.locator('div').filter({ has: page.locator('label', { hasText: 'จำนวนทั้งหมด' }) }).last().locator('input');
  await qty.fill(String(Number(await qty.inputValue()) + 10));
  await dialog.getByRole('button', { name: 'บันทึก', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'บันทึกสำเร็จ' })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('textbox', { name: 'PIN' })).toHaveCount(0);
  expect(sql(`select can_sell, can_rent, sale_price from public.products where sku = '${SALE_SKU}'`)[0]).toEqual(['t', 't', `${next}.00`]);
  expect(stockBySku(SALE_SKU).AVAILABLE).toBe(availableBefore + 10);
});

test('ขายสินค้า 3 ชิ้น: ลูกค้าทั่วไป เงินสดรับ 200 มีเงินทอน — ตัดสต็อกถาวร', async ({ page }) => {
  const before = stockBySku(SALE_SKU).AVAILABLE;
  const price = Number(sql(`select sale_price from public.products where sku = '${SALE_SKU}'`)[0][0]);
  const total = price * 3;
  await page.goto('/pos');
  await page.getByRole('button', { name: 'ขายสินค้า' }).click();
  await page.getByRole('heading', { name: SALE_PRODUCT, level: 4 }).click();
  const add = page.getByRole('dialog').filter({ hasText: 'จำนวนที่ต้องการ' });
  await add.getByRole('textbox', { name: '1' }).first().fill('3');
  await add.getByRole('button', { name: 'เพิ่มลงตะกร้า' }).click();
  await page.getByPlaceholder('ค้นหาชื่อ / เบอร์โทร หรือพิมพ์ชื่อลูกค้าทั่วไป...').fill('ลูกค้าหน้าร้าน E2E');
  await page.getByRole('button', { name: /เป็นลูกค้าทั่วไป \(Guest\)/ }).click();
  await page.getByRole('button', { name: 'ชำระเงิน' }).click();
  await page.waitForURL('**/pos/checkout');
  // A sale-only cart prints as a sale bill to a buyer, not a rental bill.
  await expect(page.getByText('บิลขาย', { exact: true })).toBeVisible();
  await expect(page.getByText('ข้อมูลผู้ซื้อ / ลูกค้า:')).toBeVisible();
  await expect(page.getByText('กำหนดการเช่าสินค้า:')).toHaveCount(0);
  await page.getByRole('button', { name: 'เงินสด' }).click();
  await amountBox(page, 'เงินสดที่รับมา (บาท)').fill('200');
  await expect(page.getByText('เงินทอน').locator('..')).toContainText((200 - total).toFixed(2));
  await page.getByRole('button', { name: 'ออกบิล' }).click();

  const billNo = await issuedBillNo(page);
  expect(billByNo(billNo)).toMatchObject({ paymentStatus: 'PAID', grandTotal: total, paid: total, balance: 0 });
  expect(stockBySku(SALE_SKU).AVAILABLE).toBe(before - 3);
});

test('เช่าแบบค้างชำระ + มัดจำ 500 (มัดจำเก็บไว้แสดง ไม่รวมในยอดที่ต้องจ่าย)', async ({ page }) => {
  await page.goto('/pos');
  await page.getByRole('button', { name: 'เช่าสินค้า' }).click();
  await page.getByRole('heading', { name: RENT_PRODUCT, level: 4 }).click();
  const add = page.getByRole('dialog').filter({ hasText: 'จำนวนที่ต้องการ' });
  await add.getByRole('textbox', { name: '1' }).first().fill('2');
  await add.getByRole('button', { name: 'เพิ่มลงตะกร้า' }).click();
  await page.getByPlaceholder('ค้นหาชื่อ / เบอร์โทร หรือพิมพ์ชื่อลูกค้าทั่วไป...').fill('ลูกค้า E2E');
  await page.getByRole('button', { name: /ลูกค้า E2E \d+/ }).first().click();
  await amountBox(page, 'เงินมัดจำ (บาท)').fill('500');
  await page.getByRole('button', { name: 'ชำระเงิน' }).click();
  await page.waitForURL('**/pos/checkout');
  await page.getByRole('button', { name: 'ค้างชำระ' }).click();
  await page.getByRole('button', { name: 'ออกบิล' }).click();

  creditBill = await issuedBillNo(page);
  expect(billByNo(creditBill)).toMatchObject({ paymentStatus: 'UNPAID', grandTotal: 30, paid: 0, balance: 30 });
  expect(sql(`select deposit_amount from public.bills where bill_no = '${creditBill}'`)[0][0]).toBe('500.00');
});

async function openReceive(page: Page) {
  await page.goto('/bills');
  await page.getByRole('row', { name: new RegExp(creditBill) }).click();
  await page.getByRole('button', { name: 'รับชำระเงิน', exact: true }).click();
  await page.getByRole('checkbox', { name: 'เลือก/ยกเลิกทั้งหมด' }).check();
  await page.getByRole('button', { name: 'ถัดไป' }).click();
  await expect(page.getByRole('heading', { name: 'ระบุยอดที่ต้องการชำระ' })).toBeVisible();
}

test('รับชำระบางส่วน 10 บาท: ยอดที่กรอกคือยอดที่บันทึก', async ({ page }) => {
  test.skip(!creditBill, 'needs the credit bill');
  await openReceive(page);
  await amountBox(page, 'ระบุยอดรับชำระเงิน (บาท)').fill('10');
  await expect(page.getByRole('main')).toContainText(/ชำระครั้งนี้\s*10\s*คงเหลือ\s*20/);
  await page.getByRole('button', { name: 'บันทึกและออกบิล' }).click();
  await expect(page.getByRole('heading', { name: 'บันทึกรับชำระเงินสำเร็จ' }).first()).toBeVisible({ timeout: 20000 });
  expect(billByNo(creditBill)).toMatchObject({ paymentStatus: 'PARTIALLY_PAID', paid: 10, balance: 20 });
});

test('รับส่วนที่เหลือแบบแบ่ง 2 ช่องทาง: เงินสด 5 + เงินโอน 15', async ({ page }) => {
  test.skip(!creditBill, 'needs the credit bill');
  await openReceive(page);
  await page.getByRole('button', { name: 'เพิ่มช่องทาง' }).click();
  const channels = page.getByRole('button', { name: 'ช่องทาง', exact: true });
  await expect(channels).toHaveCount(2);
  // A second row starts as a transfer.
  await expect(channels.nth(1)).toContainText('โอนเงิน');
  const amounts = page.getByRole('button', { name: 'ใส่ยอดที่เหลือ' });
  // The amount box comes right after each row's "ใส่ยอดที่เหลือ" button.
  const rowOf = (i: number) => amounts.nth(i).locator('xpath=following::input[1]');
  await rowOf(0).fill('5');
  await rowOf(1).fill('15');
  await expect(page.getByRole('main')).toContainText(/ชำระครั้งนี้\s*20\s*คงเหลือ\s*0/);
  await page.getByRole('button', { name: 'บันทึกและออกบิล' }).click();
  await expect(page.getByRole('heading', { name: 'บันทึกรับชำระเงินสำเร็จ' }).first()).toBeVisible({ timeout: 20000 });
  expect(billByNo(creditBill)).toMatchObject({ paymentStatus: 'PAID', paid: 30, balance: 0 });
  const methods = sql(`select p.method, p.amount from public.payments p join public.bills b on b.id = p.bill_id
    where b.bill_no = '${creditBill}' order by p.created_at, p.amount`).map(([m, a]) => `${m}:${Number(a)}`);
  expect(methods).toEqual(['CASH:10', 'CASH:5', 'TRANSFER:15']);
});

test('คืนเงินรับชำระ 10 บาท (เหตุผลไม่บังคับ ไม่ถาม PIN)', async ({ page }) => {
  test.skip(!creditBill, 'needs the credit bill');
  await page.goto('/bills');
  await page.getByRole('row', { name: new RegExp(creditBill) }).click();
  await page.getByRole('button', { name: 'คืนเงินรับชำระ', exact: true }).click();
  const dlg = page.getByRole('dialog').filter({ hasText: 'คืนเงินจากรายการรับชำระ' });
  await dlg.getByRole('textbox').first().fill('10');
  await dlg.getByPlaceholder('ระบุเหตุผล (บันทึกในประวัติการทำรายการ)').fill('คืนเงิน E2E');
  await dlg.getByRole('button', { name: 'ยืนยันคืนเงิน', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'คืนเงินสำเร็จ' }).first()).toBeVisible({ timeout: 20000 });
  expect(sql(`select refunded_amount from public.bills where bill_no = '${creditBill}'`)[0][0]).toBe('10.00');
});

test('เช่าต่อ: สร้างบิลใหม่ผูกกับบิลเดิม โดยไม่นับสต็อกซ้ำ', async ({ page }) => {
  test.skip(!creditBill, 'needs the credit bill');
  const rentedBefore = stockBySku('NR-001').RENTED_OUT;
  await page.goto('/bills');
  await page.getByRole('row', { name: new RegExp(creditBill) }).click();
  await page.getByRole('button', { name: 'เช่าต่อ', exact: true }).click();
  await page.getByPlaceholder(/ระบุเหตุผล เช่น ลูกค้าโทรแจ้งขอเช่าต่อ/).fill('ลูกค้าขอเช่าต่อ E2E');
  await page.getByRole('button', { name: 'ยืนยันเช่าต่อ' }).click();
  await expect(page.getByRole('heading', { name: 'บันทึกการเช่าต่อสำเร็จ' }).first()).toBeVisible({ timeout: 20000 });
  const [child] = sql(`select c.bill_no, c.payment_status from public.bills c join public.bills p on p.id = c.parent_bill_id
    where p.bill_no = '${creditBill}'`);
  expect(child?.[1]).toBe('UNPAID');
  expect(stockBySku('NR-001').RENTED_OUT).toBe(rentedBefore);
});
