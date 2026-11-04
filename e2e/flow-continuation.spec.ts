import { test, expect } from './fixtures';
import { sql, stockBySku } from './db';

// จัดการบิล › รับคืน with เช่าต่อ: some goods come back, some stay with the customer on a new bill,
// and the money is taken on the same payment page (owner 2026-11-04). Local Supabase only.
const SKU = 'NR-001';
const PRODUCT = 'นั่งร้าน 1.70(ชุด)';
const RENT = 4;

test.describe.configure({ mode: 'serial' });

let billNo = '';

test('เช่า 4 ชุด ไม่จ่าย (ค้างชำระ) เพื่อทดสอบคืน 1 + เช่าต่อ 2', async ({ page }) => {
  await page.goto('/pos');
  await page.getByRole('button', { name: 'เช่าสินค้า' }).click();
  await page.getByRole('heading', { name: PRODUCT, level: 4 }).click();
  const add = page.getByRole('dialog').filter({ hasText: 'จำนวนที่ต้องการ' });
  await add.getByRole('textbox', { name: '1' }).first().fill(String(RENT));
  await add.getByRole('button', { name: 'เพิ่มลงตะกร้า' }).click();

  const stamp = Date.now();
  await page.getByRole('button', { name: 'เพิ่มลูกค้า', exact: true }).click();
  const form = page.getByRole('dialog').filter({ hasText: 'บันทึกข้อมูลลูกค้าใหม่' });
  await form.getByLabel('ชื่อลูกค้า / ชื่อบริษัท').fill(`ลูกค้า เช่าต่อ ${stamp}`);
  await form.getByLabel('เบอร์โทรศัพท์หลัก').fill('09' + String(stamp).slice(-8));
  await form.getByLabel('บ้านเลขที่').fill('34');
  await form.getByRole('button', { name: 'บันทึกข้อมูลลูกค้า' }).click();
  await expect(page.getByRole('heading', { name: 'เพิ่มลูกค้าสำเร็จ' }).first()).toBeVisible();

  await page.getByRole('button', { name: 'ชำระเงิน' }).click();
  await page.waitForURL('**/pos/checkout');
  await page.getByRole('button', { name: 'ค้างชำระ' }).click();
  await page.getByRole('button', { name: 'ออกบิล' }).click();

  const done = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'บันทึกบิลเช่าสำเร็จ' }) });
  await expect(done).toBeVisible({ timeout: 20000 });
  billNo = (await done.innerText()).match(/BL-\d{8}-\d{3}/)?.[0] ?? '';
  expect(billNo).not.toBe('');
  await done.getByRole('button', { name: 'ออก' }).click();
});

test('คืนปกติ 1 + เช่าต่อ 2 (1 รอบ): ได้ใบคืน 1 ใบ และบิลเช่าต่อ 2 ชุดผูกกับบิลเดิม', async ({ page }) => {
  test.skip(!billNo, 'needs the bill from the previous step');
  const start = stockBySku(SKU);
  await page.goto('/bills');
  await page.getByRole('row', { name: new RegExp(billNo) }).click();
  await page.getByRole('button', { name: 'จัดการบิล' }).click();

  const row = page.getByRole('row', { name: new RegExp(`${PRODUCT.replace(/[().]/g, '\\$&')} ${SKU}`) });
  const boxes = row.getByRole('textbox');
  await boxes.nth(0).fill('1'); // ปกติ
  await boxes.nth(3).fill('2'); // เช่าต่อ
  await boxes.nth(4).fill('1'); // วันที่/รอบ: 1 round
  await page.getByRole('button', { name: 'ถัดไป' }).click();

  await expect(page.getByRole('heading', { name: 'สรุปยอดและรับชำระเงิน' })).toBeVisible();
  await expect(page.getByText(/รวมเช่าต่อ/)).toBeVisible();
  // ค้างชำระ: nothing is collected now
  await page.getByRole('button', { name: 'ค้างชำระ' }).click();
  await page.getByRole('button', { name: 'ออกบิล', exact: true }).click();

  const done = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'บันทึกรับคืนสินค้าสำเร็จ' }) });
  await expect(done).toBeVisible({ timeout: 30000 });
  await done.getByRole('button', { name: 'ออก' }).click();

  const children = sql(`select c.bill_no, l.ordered_qty from public.bills c
    join public.bills p on p.id = c.parent_bill_id
    join public.bill_lines l on l.bill_id = c.id
    where p.bill_no = '${billNo}'`);
  expect(children).toHaveLength(1);
  expect(Number(children[0][1])).toBe(2);
  const returned = sql(`select count(*) from public.returns r join public.bills b on b.id = r.bill_id where b.bill_no = '${billNo}'`);
  expect(returned[0][0]).toBe('1');
  // 1 came back; the 2 on the new bill are still out; 1 is still held by the old bill
  expect(stockBySku(SKU).AVAILABLE).toBe(start.AVAILABLE + 1);
});
