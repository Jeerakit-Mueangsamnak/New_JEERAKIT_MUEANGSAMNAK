import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { fillCash, issuedBillNo } from './helpers';
import { sql } from './db';

// Quotation: build in POS (quotation mode) → save → accept (reserves stock) → open the bill in
// POS → pay → the quotation is CONVERTED and linked to that bill. A second quotation is cancelled.
const RENT_PRODUCT = 'นั่งร้าน 1.70(ชุด)';

test.describe.configure({ mode: 'serial' });

let quotationNo = '';

const quotationRow = (page: Page, no: string) => page.getByRole('row', { name: new RegExp(no) });
const quotationStatus = (no: string) => sql(`select status from public.quotations where quotation_no = '${no}'`)[0]?.[0];

async function createQuotation(page: Page): Promise<string> {
  await page.goto('/pos?mode=quotation');
  await expect(page.getByText('โหมดสร้างใบเสนอราคา')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'เช่าสินค้า' }).click();
  await page.getByRole('heading', { name: RENT_PRODUCT, level: 4 }).click();
  const add = page.getByRole('dialog').filter({ hasText: 'จำนวนที่ต้องการ' });
  await add.getByRole('textbox', { name: '1' }).first().fill('2');
  await add.getByRole('button', { name: 'เพิ่มลงตะกร้า' }).click();
  await page.getByPlaceholder('ค้นหาชื่อ / เบอร์โทร หรือพิมพ์ชื่อลูกค้าทั่วไป...').fill('ลูกค้า E2E');
  await page.getByRole('button', { name: /ลูกค้า E2E \d+/ }).first().click();
  // Owner 2026-11-04: the cart goes to สรุปใบเสนอราคา (same central panel as ชำระเงิน), saved there.
  await page.getByRole('button', { name: 'สรุปใบเสนอราคา' }).click();
  await page.waitForURL('**/pos/quotation');
  await page.getByRole('button', { name: 'บันทึกใบเสนอราคา' }).click();
  await page.waitForURL('**/quotations');
  const toast = page.getByText(/^ใบเสนอราคา [A-Z]{2,4}-\d{8}-\d{3}$/);
  await expect(toast).toBeVisible({ timeout: 20000 });
  return (await toast.innerText()).replace('ใบเสนอราคา ', '').trim();
}

test('สร้างใบเสนอราคาจากหน้า POS แล้วบันทึกได้เลขที่', async ({ page }) => {
  quotationNo = await createQuotation(page);
  expect(quotationNo).toMatch(/^[A-Z]{2,4}-\d{8}-\d{3}$/);
  expect(quotationStatus(quotationNo)).toMatch(/^(DRAFT|SENT)$/);
  await expect(quotationRow(page, quotationNo)).toBeVisible();
});

test('ตอบรับใบเสนอราคา: สถานะเป็นตอบรับแล้ว', async ({ page }) => {
  test.skip(!quotationNo, 'needs the quotation');
  await page.goto('/quotations');
  await quotationRow(page, quotationNo).getByRole('button', { name: 'ตอบรับ' }).click();
  await page.getByRole('button', { name: 'ยืนยันตอบรับ' }).click();
  await expect(page.getByText('ตอบรับใบเสนอราคาสำเร็จ')).toBeVisible({ timeout: 20000 });
  expect(quotationStatus(quotationNo)).toBe('ACCEPTED');
});

test('เปิดบิลจากใบเสนอราคา: จ่ายเงินสดแล้วใบเสนอราคาผูกกับบิล', async ({ page }) => {
  test.skip(!quotationNo, 'needs the quotation');
  await page.goto('/quotations');
  await quotationRow(page, quotationNo).getByRole('button', { name: 'เปิดบิล' }).click();
  await page.getByRole('button', { name: 'เข้า POS เพื่อเปิดบิล' }).click();
  await page.waitForURL('**/pos?quotationId=*');
  await expect(page.getByText('โหลดใบเสนอราคาสำเร็จ').first()).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'ชำระเงิน' }).click();
  await page.waitForURL('**/pos/checkout');
  await page.getByRole('button', { name: 'เงินสด' }).click();
  await fillCash(page, '1000');
  await page.getByRole('button', { name: 'ออกบิล' }).click();

  const billNo = await issuedBillNo(page);
  const [row] = sql(`select q.status, b.bill_no from public.quotations q join public.bills b on b.id = q.converted_bill_id
    where q.quotation_no = '${quotationNo}'`);
  expect(row).toEqual(['CONVERTED', billNo]);
  expect(sql(`select quotation_id is not null from public.bills where bill_no = '${billNo}'`)[0][0]).toBe('t');
});

test('ยกเลิกใบเสนอราคา: เลือกสาเหตุแล้วยืนยันได้เลย ไม่ต้องพิมพ์เหตุผล และเปิดบิลต่อไม่ได้', async ({ page }) => {
  const no = await createQuotation(page);
  await quotationRow(page, no).getByRole('button', { name: 'ยกเลิก' }).click();
  const confirm = page.getByRole('button', { name: 'ยืนยันยกเลิก' });
  // The reason is a ready-made choice now (no text box, no PIN), so the button is usable at once.
  await expect(confirm).toBeEnabled();
  await expect(page.getByPlaceholder(/กรุณาระบุเหตุผล/)).toHaveCount(0);
  await confirm.click();
  await expect.poll(() => quotationStatus(no), { timeout: 20000 }).toMatch(/^(REJECTED|EXPIRED)$/);
  await expect(quotationRow(page, no).getByRole('button', { name: /^(ตอบรับ|เปิดบิล)$/ })).toHaveCount(0);
});
