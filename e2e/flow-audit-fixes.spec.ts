import { jsPDF } from 'jspdf';
import { test, expect } from './fixtures';
import { sql } from './db';

// Fixes from the 2026-10-26 audit check, on the real screens (local stack only):
// 1. a converted 10-page PDF form is saved to the shop library on the server;
// 2. a product is deactivated (not deleted), shows "ปิดใช้งาน", and is switched on again;
// 3. the quick menu's เพิ่มนัดหมาย closes only after the server saved the job.
test.describe.configure({ mode: 'serial' });

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'chromium', 'writes data: Chromium only');
});

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

function tenPagePdf(): Buffer {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  for (let i = 1; i <= 10; i++) {
    if (i > 1) doc.addPage();
    doc.setFontSize(40);
    doc.text(`PAGE ${i}`, 60, 140);
  }
  return Buffer.from(doc.output('arraybuffer'));
}

test('แบบฟอร์ม PDF 10 หน้า บันทึกเข้าคลังของร้านบนฐานข้อมูล', async ({ page }) => {
  const name = `ฟอร์มทดสอบ ${Date.now()}`;
  await page.goto('/documents');
  await page.getByRole('button', { name: 'เพิ่มแบบฟอร์ม' }).click();
  await page.getByLabel('ไฟล์ต้นฉบับแบบฟอร์ม').setInputFiles({ name: 'contract-10.pdf', mimeType: 'application/pdf', buffer: tenPagePdf() });
  await expect(page.getByText('แปลงครบ 10 หน้า')).toBeVisible({ timeout: 60000 });
  await page.getByPlaceholder('ชื่อแบบฟอร์ม / ชื่อเอกสาร').fill(name);
  await page.getByRole('button', { name: /บันทึก Template เข้าคลังระบบ/ }).click();

  await expect.poll(() => sql(`select page_count, octet_length(template_schema) from public.document_templates where name = ${lit(name)}`)[0], { timeout: 20000 })
    .toEqual([expect.stringMatching(/^10$/), expect.any(String)]);
  const bytes = Number(sql(`select octet_length(template_schema) from public.document_templates where name = ${lit(name)}`)[0][0]);
  test.info().annotations.push({ type: 'template-bytes', description: String(bytes) });
  await expect(page.getByText(name).first()).toBeVisible();
});

test('ปิดใช้งานสินค้า (ไม่ลบ) แล้วเปิดใช้งานอีกครั้ง', async ({ page }) => {
  const [productName] = sql(`select name from public.products where active order by sku limit 1`)[0];
  const active = () => sql(`select active from public.products where name = ${lit(productName)}`)[0]?.[0];
  try {
    await page.goto('/products');
    await page.getByPlaceholder('ค้นหาชื่อสินค้า...').fill(productName);
    const row = page.locator('tr', { hasText: productName }).first();
    await row.getByRole('button', { name: 'ปิดใช้งานสินค้า' }).click();
    await expect(page.getByText('ไม่สามารถเรียกคืน')).toHaveCount(0);
    await expect(page.getByText(/ข้อมูลและประวัติเดิมยังอยู่ครบ/)).toBeVisible();
    await page.getByRole('button', { name: 'ยืนยันปิดใช้งาน' }).click();
    await expect.poll(active, { timeout: 20000 }).toBe('f');
    await expect(row.getByText('ปิดใช้งาน', { exact: true })).toBeVisible();

    await row.getByRole('button', { name: 'เปิดใช้งานสินค้าอีกครั้ง' }).click();
    await expect.poll(active, { timeout: 20000 }).toBe('t');
    await expect(row.getByText('ปิดใช้งาน', { exact: true })).toHaveCount(0);
  } finally {
    sql(`update public.products set active = true where name = ${lit(productName)}`);
  }
});

test('เมนูลัด เพิ่มนัดหมาย: ปิดหน้าต่างหลังบันทึกสำเร็จจริงเท่านั้น', async ({ page }) => {
  const title = `นัดทดสอบ ${Date.now()}`;
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'เมนูลัด (Quick Actions)' }).click();
  await page.getByRole('button', { name: 'เพิ่มนัดหมาย' }).click();
  await page.getByPlaceholder('เช่น ส่งสินค้า, เก็บแบบ').fill(title);
  const [customerName] = sql(`select name from public.customers where active order by created_at limit 1`)[0];
  await page.getByPlaceholder(/พิมพ์ค้นหาชื่อลูกค้า/).fill(customerName);
  await page.getByRole('button', { name: new RegExp(customerName) }).first().click();
  await page.getByRole('button', { name: 'บันทึกการนัดหมาย' }).click();

  await expect(page.getByText('เพิ่มนัดหมายใหม่')).toHaveCount(0, { timeout: 20000 });
  expect(sql(`select count(*) from public.appointments where title = ${lit(title)}`)[0][0]).toBe('1');
});
