import { test, expect, type Page } from '@playwright/test';
import { OWNER_STATE } from './helpers';

// TEMPORARY audit script (not part of the committed suite): walks the "จัดการบิลเช่า" menu on
// Supabase Local with the data that is already in the local database and records what happens.
test.use({ storageState: OWNER_STATE });
test.setTimeout(180000);

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/.audit/${name}.png`, fullPage: false });

const consoleIssues: string[] = [];

test('audit: จัดการบิลเช่า', async ({ page }) => {
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') consoleIssues.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleIssues.push(`[pageerror] ${e.message}`));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/bills');
  await page.waitForTimeout(2500);
  await shot(page, '01-list');

  const rows = page.locator('tbody tr').filter({ hasNot: page.locator('[data-empty-row]') });
  const rowCount = await rows.count();
  console.log('AUDIT rows visible:', rowCount);
  console.log('AUDIT footer:', await page.getByText(/ทั้งหมด \d+ รายการ/).first().innerText().catch(() => 'n/a'));

  // Filters
  const select = page.getByRole('combobox').first();
  for (const label of ['ชำระแล้ว', 'ค้างชำระ', 'คืนครบ', 'ค้างคืน', 'ทั้งหมด']) {
    await select.click();
    await page.getByRole('option', { name: label, exact: true }).click();
    await page.waitForTimeout(300);
    console.log(`AUDIT filter ${label}:`, await rows.count());
  }
  await page.getByRole('button', { name: 'บิลทั้งหมด' }).click();
  await page.waitForTimeout(400);
  console.log('AUDIT filter บิลทั้งหมด(closed):', await rows.count());
  await shot(page, '02-closed-filter');
  await page.getByRole('button', { name: 'บิลทั้งหมด' }).click();
  await page.waitForTimeout(300);

  // Search
  await page.getByPlaceholder('ค้นหาเลขบิล, ชื่อลูกค้า หรือ เบอร์โทรศัพท์...').fill('BL-04112569-038');
  await page.waitForTimeout(400);
  console.log('AUDIT search hit rows:', await rows.count());
  await page.getByPlaceholder('ค้นหาเลขบิล, ชื่อลูกค้า หรือ เบอร์โทรศัพท์...').fill('ไม่มีทางเจอ');
  await page.waitForTimeout(300);
  console.log('AUDIT search empty rows:', await rows.count(), 'empty text:', await page.getByText('ยังไม่มีรายการบิล').count());
  await page.getByPlaceholder('ค้นหาเลขบิล, ชื่อลูกค้า หรือ เบอร์โทรศัพท์...').fill('');
  await page.waitForTimeout(300);

  // Select first row, look at toolbar
  await rows.first().click();
  await page.waitForTimeout(300);
  const toolbar = page.getByTestId('bill-toolbar');
  console.log('AUDIT toolbar buttons:', await toolbar.getByRole('button').allInnerTexts());
  await shot(page, '03-row-selected');

  // Open จัดการบิล
  await toolbar.getByRole('button', { name: /จัดการบิล/ }).click();
  await page.waitForTimeout(1200);
  await shot(page, '04-workspace-return');
  console.log('AUDIT tabs:', await page.getByRole('tab').allInnerTexts());
  const firstRow = page.locator('table tbody tr').first();
  console.log('AUDIT return rows:', await page.locator('table tbody tr').count());
  console.log('AUDIT first return row text:', (await firstRow.innerText().catch(() => '')).slice(0, 200));

  // type a quantity in ปกติ
  const qty = firstRow.getByRole('textbox').first();
  if (await qty.count()) {
    await qty.fill('1');
    await page.waitForTimeout(400);
    await shot(page, '05-return-qty1');
    await page.getByRole('button', { name: 'ถัดไป' }).click();
    await page.waitForTimeout(1500);
    await shot(page, '06-step2-preview');
    const net = await page.getByText('ลูกค้าต้องชำระเพิ่ม').count();
    console.log('AUDIT step2 marker(ต้องชำระเพิ่ม):', net);
    await page.getByRole('button', { name: 'ย้อนกลับ' }).click();
    await page.waitForTimeout(400);
  }

  // Other tabs
  await page.getByRole('tab', { name: 'เอกสาร' }).click();
  await page.waitForTimeout(700);
  await shot(page, '07-docs-tab');
  await page.getByRole('tab', { name: 'ประวัติรายการ' }).click();
  await page.waitForTimeout(1200);
  await shot(page, '08-history-tab');

  // back to list: reload to drop the workspace
  await page.goto('/bills');
  await page.waitForTimeout(2000);

  // Double-click preview
  await rows.first().dblclick();
  await page.waitForTimeout(1200);
  await shot(page, '09-preview-overlay');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ยกเลิกบิล dialog (owner has BILL_VOID) - open then close without submitting
  await rows.first().click();
  const cancelBtn = page.locator('tbody tr').first().getByTitle('ยกเลิกบิล');
  if (await cancelBtn.count()) {
    await cancelBtn.first().click();
    await page.waitForTimeout(600);
    await shot(page, '10-cancel-dialog');
    await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
    await page.waitForTimeout(400);
  }

  // Other toolbar entries
  await rows.first().click();
  const open = async (name: RegExp, file: string) => {
    const btn = toolbar.getByRole('button', { name });
    if (await btn.isDisabled()) return console.log(`AUDIT ${name} disabled for this bill`);
    await btn.click();
    await page.waitForTimeout(1200);
    await shot(page, file);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  };
  await open(/แก้ไขบิล/, '11-correction');
  await open(/ส่งของ/, '12-delivery');
  await open(/คืนเงินรับชำระ/, '13-refund');
  await open(/สั่งงาน/, '14-dispatch');

  // Empty-area click clears the selection?
  await rows.nth(2).click();
  await page.waitForTimeout(200);
  const beforeDeselect = await toolbar.getByRole('button', { name: /จัดการบิล/ }).isDisabled();
  await page.mouse.click(720, 60);
  await page.waitForTimeout(300);
  const afterDeselect = await toolbar.getByRole('button', { name: /จัดการบิล/ }).isDisabled();
  console.log('AUDIT deselect: before(disabled?)', beforeDeselect, 'after blank click(disabled?)', afterDeselect);

  // Responsive
  for (const w of [1280, 1024, 820, 768]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(500);
    await shot(page, `20-responsive-${w}`);
  }

  // Mobile card view
  await page.setViewportSize({ width: 420, height: 900 });
  await page.waitForTimeout(600);
  await shot(page, '21-mobile');

  console.log('AUDIT console issues:', consoleIssues.length ? '\n' + consoleIssues.join('\n') : 'none');
  expect(true).toBe(true);
});
