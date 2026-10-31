import { jsPDF } from 'jspdf';
import { test, expect } from './fixtures';
import { trackPageErrors } from './helpers';

// จัดการเอกสาร › เพิ่มแบบฟอร์ม: a 10-page PDF is read in the browser (pdf.js) and every page
// shows in the A4 preview, not only the first one.
function tenPagePdf(): Buffer {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  for (let i = 1; i <= 10; i++) {
    if (i > 1) doc.addPage();
    doc.setFontSize(40);
    doc.text(`PAGE ${i}`, 60, 140);
  }
  return Buffer.from(doc.output('arraybuffer'));
}

test('a 10-page PDF form converts with all 10 pages', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'upload flow runs once, on Chromium');
  const health = trackPageErrors(page);
  await page.goto('/documents');
  await page.getByRole('button', { name: 'เพิ่มแบบฟอร์ม' }).click();

  await page.getByLabel('ไฟล์ต้นฉบับแบบฟอร์ม').setInputFiles({ name: 'contract-10.pdf', mimeType: 'application/pdf', buffer: tenPagePdf() });
  await expect(page.getByText('แปลงครบ 10 หน้า')).toBeVisible({ timeout: 60000 });

  const pages = page.locator('.pos-a4-fit-sheet img[alt^="หน้า "]');
  await expect(pages).toHaveCount(10);
  await expect(pages.last()).toHaveAttribute('alt', 'หน้า 10');
  // The preview sheet grows to hold every page instead of clipping at one A4 height.
  const sheet = page.locator('.pos-a4-fit-sheet', { has: page.locator('img[alt="หน้า 10"]') });
  await expect.poll(() => sheet.evaluate((el) => (el as HTMLElement).offsetHeight), { timeout: 15000 }).toBeGreaterThan(1123 * 9);
  await pages.last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/theme/documents-pdf-page-10.png' });
  health.expectNone();
});
