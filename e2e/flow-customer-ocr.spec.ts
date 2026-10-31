import { writeFileSync, mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { sql } from './db';

// เพิ่มลูกค้าใหม่: typed by hand (save → close → open new → edit) and with the ID card OCR on
// generated card images (clear, low-res, blurred, tilted, glare). The OCR may leave fields empty,
// but it must never put a wrong value in a field. Accuracy per field is written to
// test-results/ocr-accuracy.json (or OCR_REPORT_DIR) — these are synthetic cards, not real ones.
test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'chromium', 'writes customers: Chromium only');
});

function withCheckDigit(first12: string) {
  const sum = [...first12].reduce((acc, d, i) => acc + Number(d) * (13 - i), 0);
  return first12 + ((11 - (sum % 11)) % 10);
}
const ID = withCheckDigit('110170020345'); // fictional, valid check digit
const TRUTH = {
  'ชื่อลูกค้า / ชื่อบริษัท': 'นาย ทดสอบ ระบบดี',
  'เลขบัตรประชาชน / เลขผู้เสียภาษี': `${ID[0]}-${ID.slice(1, 5)}-${ID.slice(5, 10)}-${ID.slice(10, 12)}-${ID[12]}`,
  'บ้านเลขที่': '99/1',
  'หมู่': '5',
  'รหัสไปรษณีย์': '',
} as const;
const TRUTH_SELECTS = { 'จังหวัด': 'สมุทรปราการ', 'อำเภอ / เขต': 'บางพลี', 'ตำบล / แขวง': 'บางพลีใหญ่' } as const;

const field = (page: Page, label: string) => page.getByRole('dialog').getByLabel(label, { exact: true });
const selectText = (page: Page, label: string) => page.getByRole('dialog').getByRole('button', { name: label, exact: true }).innerText();

async function openNewCustomer(page: Page) {
  await page.goto('/customers');
  await page.getByRole('button', { name: 'เพิ่มลูกค้าใหม่' }).click();
  await expect(page.getByRole('heading', { name: 'บันทึกข้อมูลลูกค้าใหม่' })).toBeVisible({ timeout: 20000 });
}

async function pick(page: Page, label: string, option: string) {
  await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
  await page.getByPlaceholder('พิมพ์ค้นหา...').fill(option);
  // Sub-district options also show "ปณ. <postal code>" after the name.
  await page.getByRole('button', { name: new RegExp(`^${option}(\\s|$)`) }).click();
}

async function expectAllEmpty(page: Page) {
  for (const label of ['ชื่อลูกค้า / ชื่อบริษัท', 'เบอร์โทรศัพท์หลัก', 'บ้านเลขที่', 'หมู่', 'รหัสไปรษณีย์', 'เลขบัตรประชาชน / เลขผู้เสียภาษี']) {
    await expect(field(page, label), label).toHaveValue('');
  }
  expect(await selectText(page, 'จังหวัด')).toContain('เลือกจังหวัด');
}

test('กรอกเอง: เลือกจังหวัดแล้วไม่มีการเลือกอำเภอ/ตำบลให้เอง บันทึก ปิด เปิดใหม่ว่าง แก้ไขแล้วลบช่องได้', async ({ page }) => {
  const stamp = Date.now();
  const name = `ลูกค้ากรอกเอง ${stamp}`;
  await openNewCustomer(page);
  await expectAllEmpty(page);

  await field(page, 'ชื่อลูกค้า / ชื่อบริษัท').fill(name);
  await field(page, 'เบอร์โทรศัพท์หลัก').fill('09' + String(stamp).slice(-8));
  await field(page, 'บ้านเลขที่').fill('12');
  await field(page, 'หมู่').fill('3');
  await pick(page, 'จังหวัด', 'สมุทรปราการ');
  // Choosing a province must not pick a district / sub-district / postal code by itself.
  expect(await selectText(page, 'อำเภอ / เขต')).toContain('เลือกอำเภอ');
  expect(await selectText(page, 'ตำบล / แขวง')).toContain('เลือกตำบล');
  await expect(field(page, 'รหัสไปรษณีย์')).toHaveValue('');
  await pick(page, 'อำเภอ / เขต', 'บางพลี');
  expect(await selectText(page, 'ตำบล / แขวง')).toContain('เลือกตำบล');
  await pick(page, 'ตำบล / แขวง', 'บางพลีใหญ่');
  await expect(field(page, 'รหัสไปรษณีย์')).toHaveValue('10540');
  await page.getByRole('button', { name: 'บันทึกข้อมูลลูกค้า' }).click();
  await expect(page.getByText('เพิ่มลูกค้าใหม่สำเร็จ')).toBeVisible({ timeout: 20000 });

  const [row] = sql(`select address, contact_details->>'moo', contact_details->>'postalCode' from public.customers where name = '${name}'`);
  expect(row).toEqual(['เลขที่ 12 หมู่ 3 ต.บางพลีใหญ่ อ.บางพลี จ.สมุทรปราการ 10540', '3', '10540']);

  // A new form right after saving holds nothing from the customer just saved.
  await page.getByRole('button', { name: 'เพิ่มลูกค้าใหม่' }).click();
  await expectAllEmpty(page);
  await page.getByRole('dialog').getByRole('button', { name: 'ยกเลิก', exact: true }).click();

  // Edit the saved customer: values come back; a cleared field stays cleared after saving.
  await page.getByRole('button', { name: 'แก้ไขข้อมูล' }).click();
  await expect(field(page, 'ชื่อลูกค้า / ชื่อบริษัท')).toHaveValue(name);
  await expect(field(page, 'หมู่')).toHaveValue('3');
  await field(page, 'หมู่').fill('');
  await page.getByRole('button', { name: 'บันทึกข้อมูลลูกค้า' }).click();
  await expect.poll(() => sql(`select contact_details ? 'moo', address from public.customers where name = '${name}'`)[0], { timeout: 20000 })
    .toEqual(['f', 'เลขที่ 12 ต.บางพลีใหญ่ อ.บางพลี จ.สมุทรปราการ 10540']);
  await page.getByRole('button', { name: 'แก้ไขข้อมูล' }).click();
  await expect(field(page, 'หมู่')).toHaveValue('');
});

// ── OCR on generated card images ──────────────────────────────────────────────────────────

type Variant = 'clear' | 'lowres' | 'blur2' | 'blur4' | 'tilt8' | 'glare';
const VARIANTS: Variant[] = ['clear', 'lowres', 'blur2', 'blur4', 'tilt8', 'glare'];

async function cardImage(page: Page, variant: Variant): Promise<Buffer> {
  const dataUrl = await page.evaluate(({ variant, id }) => {
    const W = 1712, H = 1080;
    const card = document.createElement('canvas');
    card.width = W; card.height = H;
    const c = card.getContext('2d')!;
    c.fillStyle = '#e8f0f7'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#1e293b';
    const t = (text: string, x: number, y: number, size: number, bold = false) => {
      c.font = `${bold ? 'bold ' : ''}${size}px Tahoma`; c.fillText(text, x, y);
    };
    t('บัตรประจำตัวประชาชน Thai National ID Card', 300, 90, 52, true);
    t(`เลขประจำตัวประชาชน  ${id[0]} ${id.slice(1, 5)} ${id.slice(5, 10)} ${id.slice(10, 12)} ${id[12]}`, 120, 190, 50, true);
    t('ชื่อตัวและชื่อสกุล  นาย ทดสอบ ระบบดี', 120, 290, 54, true);
    t('Name Mr. Thodsob', 120, 360, 42);
    t('Last name Rabobdee', 120, 420, 42);
    t('เกิดวันที่ 12 ม.ค. 2530', 120, 500, 44);
    t('Date of Birth 12 Jan. 1987', 120, 560, 42);
    t('ที่อยู่ 99/1 หมู่ที่ 5 ต.บางพลีใหญ่ อ.บางพลี จ.สมุทรปราการ', 120, 680, 44);
    t('1 ก.พ. 2560', 120, 820, 40); t('31 ม.ค. 2569', 1100, 820, 40);
    t('วันออกบัตร', 120, 870, 34); t('วันบัตรหมดอายุ', 1100, 870, 34);
    t('1 Feb. 2017', 120, 940, 36); t('31 Jan. 2026', 1100, 940, 36);

    const out = document.createElement('canvas');
    const scale = variant === 'lowres' ? 0.35 : 0.5;
    out.width = W * scale; out.height = H * scale;
    const o = out.getContext('2d')!;
    o.fillStyle = '#ffffff'; o.fillRect(0, 0, out.width, out.height);
    if (variant === 'blur2') o.filter = 'blur(2px)';
    if (variant === 'blur4') o.filter = 'blur(4px)';
    if (variant === 'tilt8') {
      o.translate(out.width / 2, out.height / 2); o.rotate((8 * Math.PI) / 180); o.scale(0.85, 0.85); o.translate(-out.width / 2, -out.height / 2);
    }
    o.drawImage(card, 0, 0, out.width, out.height);
    if (variant === 'glare') {
      o.setTransform(1, 0, 0, 1, 0, 0); o.filter = 'none';
      const g = o.createRadialGradient(out.width * 0.45, out.height * 0.6, 10, out.width * 0.45, out.height * 0.6, out.width * 0.3);
      g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      o.fillStyle = g; o.fillRect(0, 0, out.width, out.height);
    }
    return out.toDataURL('image/jpeg', 0.9);
  }, { variant, id: ID });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

const report: Record<string, Record<string, string>> = {};

for (const variant of VARIANTS) {
  test(`OCR บัตรจำลอง (${variant}): ไม่มีช่องไหนถูกเติมค่าผิด`, async ({ page }) => {
    test.setTimeout(240000);
    await openNewCustomer(page);
    const image = await cardImage(page, variant);
    // "อัปโหลดรูปบัตร" (top of the window) opens the device file picker: hand the file to its input.
    await page.getByLabel('อัปโหลดรูปบัตรประชาชน').setInputFiles({ name: `card-${variant}.jpg`, mimeType: 'image/jpeg', buffer: image });
    const status = page.getByRole('status', { name: 'ผลการอ่านบัตร' });
    await expect(status).toBeVisible({ timeout: 200000 });

    const result: Record<string, string> = { status: (await status.innerText()).replace(/\s+/g, ' ') };
    const wrong: string[] = [];
    for (const [label, truth] of Object.entries(TRUTH)) {
      const got = await field(page, label).inputValue();
      result[label] = got === '' ? (truth === '' ? 'ว่าง (ถูก)' : 'ว่าง (อ่านไม่ได้)') : got === truth ? 'ถูก' : `ผิด: ${got}`;
      if (got !== '' && got !== truth) wrong.push(`${label}=${got}`);
    }
    for (const [label, truth] of Object.entries(TRUTH_SELECTS)) {
      const shown = (await selectText(page, label)).trim();
      const empty = /^-- เลือก/.test(shown);
      result[label] = empty ? 'ว่าง (อ่านไม่ได้)' : shown === truth ? 'ถูก' : `ผิด: ${shown}`;
      if (!empty && shown !== truth) wrong.push(`${label}=${shown}`);
    }
    report[variant] = result;
    const dir = process.env.OCR_REPORT_DIR || 'test-results';
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/ocr-accuracy.json`, JSON.stringify(report, null, 2));
    console.log(`[OCR ${variant}]`, JSON.stringify(result));
    expect(wrong, 'OCR must leave a field empty rather than fill a wrong value').toEqual([]);
  });
}

test('OCR แล้วต้องติ๊กตรวจก่อนบันทึก จากนั้นบันทึกได้และแก้ไขได้', async ({ page }) => {
  test.setTimeout(240000);
  const phone = '09' + String(Date.now()).slice(-8);
  await openNewCustomer(page);
  const image = await cardImage(page, 'clear');
  await page.getByLabel('อัปโหลดรูปบัตรประชาชน').setInputFiles({ name: 'card.jpg', mimeType: 'image/jpeg', buffer: image });
  await expect(page.getByRole('status', { name: 'ผลการอ่านบัตร' })).toBeVisible({ timeout: 200000 });
  const review = page.getByRole('checkbox', { name: /ฉันตรวจข้อมูลที่อ่านจากบัตรแล้ว/ });
  test.skip(!(await review.isVisible()), 'OCR read nothing on this machine — see the accuracy report');

  // Make the record unique and complete what the card cannot give.
  const name = `${await field(page, 'ชื่อลูกค้า / ชื่อบริษัท').inputValue() || 'ลูกค้า OCR'} ${phone.slice(-4)}`;
  await field(page, 'ชื่อลูกค้า / ชื่อบริษัท').fill(name);
  await field(page, 'เบอร์โทรศัพท์หลัก').fill(phone);
  if (!(await field(page, 'บ้านเลขที่').inputValue())) await field(page, 'บ้านเลขที่').fill('99/1');
  await page.getByRole('button', { name: 'บันทึกข้อมูลลูกค้า' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'ติ๊กยืนยัน' })).toBeVisible();
  await review.check();
  await page.getByRole('button', { name: 'บันทึกข้อมูลลูกค้า' }).click();
  await expect(page.getByText('เพิ่มลูกค้าใหม่สำเร็จ')).toBeVisible({ timeout: 20000 });
  const [row] = sql(`select contact_details->>'postalCode', contact_details->>'idCardNumber' from public.customers where phone = '${phone}'`);
  expect(row?.[0] ?? '').toBe(''); // never filled from the card
  await page.getByRole('button', { name: 'แก้ไขข้อมูล' }).click();
  await expect(field(page, 'ชื่อลูกค้า / ชื่อบริษัท')).toHaveValue(name);
});
