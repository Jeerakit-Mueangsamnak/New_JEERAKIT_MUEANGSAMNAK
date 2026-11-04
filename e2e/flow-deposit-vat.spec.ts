import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { amountBox, issuedBillNo } from './helpers';
import { billByNo, sql } from './db';

// Parts that had no browser test yet (2026-11-04): the รวม VAT / ไม่รวม VAT buttons on the payment page, and the
// deposit (คืน / เพิ่ม) on the return screen with its effect on the net amount. Local Supabase only.
const SALE_SKU = 'NR-004';
const SALE_PRODUCT = 'ขาปรับระดับ';
const RENT_SKU = 'NR-001';
const RENT_PRODUCT = 'นั่งร้าน 1.70(ชุด)';

test.describe.configure({ mode: 'serial' });

let depositBill = '';

test.afterAll(() => {
  // Put the shop back as it was: no VAT rate set.
  sql(`update public.store_settings set vat_enabled = false, vat_rate = null, vat_mode = null`);
});

test('ปุ่ม ไม่รวม VAT หน้าชำระเงิน: กดแล้วยอดบวก VAT 7% และบิลบันทึกตามนั้น', async ({ page }) => {
  // The shop owner must set a rate first; otherwise the two VAT buttons are greyed out.
  // Owner 2026-11-04: Settings hold only the rate (no price mode).
  sql(`update public.store_settings set vat_enabled = false, vat_rate = 7, vat_mode = null`);
  if (!sql(`select sale_price from public.products where sku = '${SALE_SKU}'`)[0]?.[0]) {
    sql(`update public.products set sale_price = 50 where sku = '${SALE_SKU}'`);
  }
  const price = Number(sql(`select sale_price from public.products where sku = '${SALE_SKU}'`)[0][0]);
  const subtotal = price * 2;
  const vat = Math.round(subtotal * 0.07 * 100) / 100;

  await page.goto('/pos');
  await page.getByRole('button', { name: 'ขายสินค้า' }).click();
  await page.getByRole('heading', { name: SALE_PRODUCT, level: 4 }).click();
  const add = page.getByRole('dialog').filter({ hasText: 'จำนวนที่ต้องการ' });
  await add.getByRole('textbox', { name: '1' }).first().fill('2');
  await add.getByRole('button', { name: 'เพิ่มลงตะกร้า' }).click();
  await page.getByPlaceholder('ค้นหาชื่อ / เบอร์โทร หรือพิมพ์ชื่อลูกค้าทั่วไป...').fill('ลูกค้าหน้าร้าน E2E');
  await page.getByRole('button', { name: /เป็นลูกค้าทั่วไป \(Guest\)/ }).click();
  await page.getByRole('button', { name: 'ชำระเงิน' }).click();
  await page.waitForURL('**/pos/checkout');

  const excl = page.getByRole('button', { name: 'ไม่รวม VAT' });
  await expect(excl).toBeEnabled();
  await expect(excl).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'รวม VAT', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('ภาษีมูลค่าเพิ่ม 7%')).toHaveCount(0);
  await excl.click();
  await expect(excl).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('ภาษีมูลค่าเพิ่ม 7%')).toBeVisible();

  await page.getByRole('button', { name: 'เงินสด' }).click();
  await amountBox(page, 'เงินสดที่รับมา (บาท)').fill('1000');
  await page.getByRole('button', { name: 'ออกบิล' }).click();
  const billNo = await issuedBillNo(page);

  const [row] = sql(`select vat_enabled, vat_amount, grand_total, vat_mode from public.bills where bill_no = '${billNo}'`);
  expect(row[0]).toBe('t');
  expect(Number(row[1])).toBeCloseTo(vat, 2);
  expect(Number(row[2])).toBeCloseTo(subtotal + vat, 2);
  expect(row[3]).toBe('EXCLUSIVE');
});

test('ปุ่ม รวม VAT: VAT อยู่ในราคา ยอดบิลไม่เพิ่ม แม้ตั้งค่าร้านเป็น "ไม่รวม"', async ({ page }) => {
  // The shop setting says EXCLUSIVE; the button on this bill decides.
  sql(`update public.store_settings set vat_rate = 7, vat_mode = 'EXCLUSIVE'`);
  const price = Number(sql(`select sale_price from public.products where sku = '${SALE_SKU}'`)[0][0]);
  const vatInside = Math.round(((price * 7) / 107) * 100) / 100;

  await page.goto('/pos');
  await page.getByRole('button', { name: 'ขายสินค้า' }).click();
  await page.getByRole('heading', { name: SALE_PRODUCT, level: 4 }).click();
  const add = page.getByRole('dialog').filter({ hasText: 'จำนวนที่ต้องการ' });
  await add.getByRole('textbox', { name: '1' }).first().fill('1');
  await add.getByRole('button', { name: 'เพิ่มลงตะกร้า' }).click();
  await page.getByPlaceholder('ค้นหาชื่อ / เบอร์โทร หรือพิมพ์ชื่อลูกค้าทั่วไป...').fill('ลูกค้าหน้าร้าน E2E');
  await page.getByRole('button', { name: /เป็นลูกค้าทั่วไป \(Guest\)/ }).click();
  await page.getByRole('button', { name: 'ชำระเงิน' }).click();
  await page.waitForURL('**/pos/checkout');

  const incl = page.getByRole('button', { name: 'รวม VAT', exact: true });
  await incl.click();
  await expect(incl).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('ภาษีมูลค่าเพิ่ม 7% (รวมในราคาแล้ว)')).toBeVisible();
  await page.getByRole('button', { name: 'เงินสด' }).click();
  await amountBox(page, 'เงินสดที่รับมา (บาท)').fill('1000');
  await page.getByRole('button', { name: 'ออกบิล' }).click();
  const billNo = await issuedBillNo(page);

  const [row] = sql(`select vat_enabled, vat_amount, grand_total, vat_mode from public.bills where bill_no = '${billNo}'`);
  expect(row[0]).toBe('t');
  expect(Number(row[1])).toBeCloseTo(vatInside, 2);
  expect(Number(row[2])).toBeCloseTo(price, 2);
  expect(row[3]).toBe('INCLUSIVE');
});

test('ไม่กดปุ่ม VAT: บิลไม่มี VAT', async ({ page }) => {
  const price = Number(sql(`select sale_price from public.products where sku = '${SALE_SKU}'`)[0][0]);
  await page.goto('/pos');
  await page.getByRole('button', { name: 'ขายสินค้า' }).click();
  await page.getByRole('heading', { name: SALE_PRODUCT, level: 4 }).click();
  const add = page.getByRole('dialog').filter({ hasText: 'จำนวนที่ต้องการ' });
  await add.getByRole('textbox', { name: '1' }).first().fill('1');
  await add.getByRole('button', { name: 'เพิ่มลงตะกร้า' }).click();
  await page.getByPlaceholder('ค้นหาชื่อ / เบอร์โทร หรือพิมพ์ชื่อลูกค้าทั่วไป...').fill('ลูกค้าหน้าร้าน E2E');
  await page.getByRole('button', { name: /เป็นลูกค้าทั่วไป \(Guest\)/ }).click();
  await page.getByRole('button', { name: 'ชำระเงิน' }).click();
  await page.waitForURL('**/pos/checkout');

  await expect(page.getByRole('button', { name: 'รวม VAT', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'ไม่รวม VAT' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'เงินสด' }).click();
  await amountBox(page, 'เงินสดที่รับมา (บาท)').fill('1000');
  await page.getByRole('button', { name: 'ออกบิล' }).click();
  const billNo = await issuedBillNo(page);

  const [row] = sql(`select vat_enabled, vat_amount, grand_total from public.bills where bill_no = '${billNo}'`);
  expect(row[0]).toBe('f');
  expect(Number(row[1])).toBe(0);
  expect(Number(row[2])).toBeCloseTo(price, 2);
});

test('ใบเสนอราคา: กด รวม VAT แล้วบันทึก — เก็บวิธีคิดไว้ และเปิดบิลต่อได้ปุ่มเดิม', async ({ page }) => {
  // Owner 2026-11-04: quotations use the same รวม / ไม่รวม VAT buttons; the shop sets only the rate.
  sql(`update public.store_settings set vat_rate = 7, vat_mode = null`);
  await page.goto('/pos?mode=quotation');
  await expect(page.getByText('โหมดสร้างใบเสนอราคา')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'เช่าสินค้า' }).click();
  await page.getByRole('heading', { name: RENT_PRODUCT, level: 4 }).click();
  const add = page.getByRole('dialog').filter({ hasText: 'จำนวนที่ต้องการ' });
  await add.getByRole('textbox', { name: '1' }).first().fill('2');
  await add.getByRole('button', { name: 'เพิ่มลงตะกร้า' }).click();
  await page.getByPlaceholder('ค้นหาชื่อ / เบอร์โทร หรือพิมพ์ชื่อลูกค้าทั่วไป...').fill('ลูกค้า E2E');
  await page.getByRole('button', { name: /ลูกค้า E2E \d+/ }).first().click();
  const incl = page.getByRole('button', { name: 'รวม VAT', exact: true });
  await incl.click();
  await expect(incl).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'บันทึกใบเสนอราคา' }).click();
  await page.waitForURL('**/quotations');
  const toast = page.getByText(/^ใบเสนอราคา [A-Z]{2,4}-\d{8}-\d{3}$/);
  await expect(toast).toBeVisible({ timeout: 20000 });
  const no = (await toast.innerText()).replace('ใบเสนอราคา ', '').trim();

  const [q] = sql(`select pricing_snapshot ->> 'vat_mode', vat_amount, grand_total, subtotal + delivery_fee
    from public.quotations where quotation_no = '${no}'`);
  expect(q[0]).toBe('INCLUSIVE');
  expect(Number(q[1])).toBeGreaterThan(0);
  expect(Number(q[2])).toBeCloseTo(Number(q[3]), 2);
  expect(Number(q[1])).toBeCloseTo(Math.round((Number(q[2]) * 7 / 107) * 100) / 100, 2);

  // Open the bill from it: the payment page starts with รวม VAT pressed.
  const row = page.getByRole('row', { name: new RegExp(no) });
  await row.getByRole('button', { name: 'ตอบรับ' }).click();
  await page.getByRole('button', { name: 'ยืนยันตอบรับ' }).click();
  await expect(page.getByText('ตอบรับใบเสนอราคาสำเร็จ')).toBeVisible({ timeout: 20000 });
  await row.getByRole('button', { name: 'เปิดบิล' }).click();
  await page.getByRole('button', { name: 'เข้า POS เพื่อเปิดบิล' }).click();
  await page.waitForURL('**/pos?quotationId=*');
  await expect(page.getByText('โหลดใบเสนอราคาสำเร็จ').first()).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'ชำระเงิน' }).click();
  await page.waitForURL('**/pos/checkout');
  await expect(page.getByRole('button', { name: 'รวม VAT', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'ไม่รวม VAT' })).toHaveAttribute('aria-pressed', 'false');
});

async function rentWithDeposit(page: Page, deposit: number) {
  const stamp = Date.now();
  await page.goto('/pos');
  await page.getByRole('button', { name: 'เช่าสินค้า' }).click();
  await page.getByRole('heading', { name: RENT_PRODUCT, level: 4 }).click();
  const add = page.getByRole('dialog').filter({ hasText: 'จำนวนที่ต้องการ' });
  await add.getByRole('textbox', { name: '1' }).first().fill('2');
  await add.getByRole('button', { name: 'เพิ่มลงตะกร้า' }).click();
  await page.getByRole('button', { name: 'เพิ่มลูกค้า', exact: true }).click();
  const form = page.getByRole('dialog').filter({ hasText: 'บันทึกข้อมูลลูกค้าใหม่' });
  await form.getByLabel('ชื่อลูกค้า / ชื่อบริษัท').fill(`ลูกค้า มัดจำ ${stamp}`);
  await form.getByLabel('เบอร์โทรศัพท์หลัก').fill('06' + String(stamp).slice(-8));
  await form.getByLabel('บ้านเลขที่').fill('56');
  await form.getByRole('button', { name: 'บันทึกข้อมูลลูกค้า' }).click();
  await expect(page.getByRole('heading', { name: 'เพิ่มลูกค้าสำเร็จ' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'ชำระเงิน' }).click();
  await page.waitForURL('**/pos/checkout');
  await amountBox(page, 'เงินมัดจำ (บาท)').fill(String(deposit));
  await page.getByRole('button', { name: 'เงินสด' }).click();
  await amountBox(page, 'เงินสดที่รับมา (บาท)').fill('1000');
  await page.getByRole('button', { name: 'ออกบิล' }).click();
  return issuedBillNo(page);
}

test('เช่า 2 ชุด มัดจำ 500 จ่ายเงินสด: ยอดสุทธิที่หน้าชำระรวมมัดจำ', async ({ page }) => {
  depositBill = await rentWithDeposit(page, 500);
  // The bill is 30; the 500 deposit is held on the bill, not part of the bill total.
  expect(billByNo(depositBill)).toMatchObject({ grandTotal: 30, paymentStatus: 'PAID' });
  expect(sql(`select deposit_amount from public.bills where bill_no = '${depositBill}'`)[0][0]).toBe('500.00');
});

test('รับคืน: คืนมัดจำ 300 จาก 500 — ตัวเลขบนหน้าจอและยอดสุทธิถูกต้อง', async ({ page }) => {
  test.skip(!depositBill, 'needs the bill from the previous step');
  await page.goto('/bills');
  await page.getByRole('row', { name: new RegExp(depositBill) }).click();
  await page.getByRole('button', { name: 'จัดการบิล' }).click();
  const row = page.getByRole('row', { name: new RegExp(`${RENT_PRODUCT.replace(/[().]/g, '\\$&')} ${RENT_SKU}`) });
  await row.getByRole('textbox').nth(0).fill('2'); // normal condition, both sets
  // The deposit row lives on the summary page that "ถัดไป" opens.
  await page.getByRole('button', { name: 'ถัดไป' }).click();
  await expect(page.getByRole('heading', { name: 'สรุปยอดและรับชำระเงิน' })).toBeVisible();

  // Before choosing anything the box shows the deposit held, switched off.
  const box = page.getByRole('textbox', { name: 'จำนวนเงินมัดจำ' });
  await expect(box).toBeDisabled();
  await expect(box).toHaveValue(/500/);

  await page.getByLabel('คืน', { exact: true }).check();
  await box.fill('300');
  await expect(page.getByText('มัดจำคงเหลือหลังบันทึก 200.00 บาท')).toBeVisible();
  await expect(page.getByText(/รวมมัดจำที่คืน 300\.00 บาทแล้ว/)).toBeVisible();
  await expect(page.getByText('ต้องคืนเงินให้ลูกค้า')).toBeVisible();

  // Cannot refund more than is held: typing 900 and leaving the box brings it back to the 500 held.
  await box.fill('900');
  await box.press('Tab');
  await expect(box).toHaveValue(/500/);
  await box.fill('300');
  await box.press('Tab');
  await expect(page.getByText('มัดจำคงเหลือหลังบันทึก 200.00 บาท')).toBeVisible();

  await page.getByRole('button', { name: 'ออกบิล', exact: true }).click();
  const done = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'บันทึกรับคืนสินค้าสำเร็จ' }) });
  await expect(done).toBeVisible({ timeout: 30000 });
  await done.getByRole('button', { name: 'ออก' }).click();

  // 500 held - 300 handed back = 200 still held (the bill closes once everything is back).
  expect(sql(`select deposit_amount from public.bills where bill_no = '${depositBill}'`)[0][0]).toBe('200.00');
  expect(billByNo(depositBill)?.status).toBe('CLOSED');
});
