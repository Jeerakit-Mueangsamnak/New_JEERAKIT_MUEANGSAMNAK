import { test, expect } from './fixtures';
import { trackPageErrors } from './helpers';

// Every main menu opens for the owner without a crash.
// Feature list: 41, 66, 76-78, 92, 97, 110, 125, 141, 150, 156, 170, 14, 182.
const PAGES: [path: string, heading: string][] = [
  ['/dashboard', 'แดชบอร์ด'],
  ['/reports', 'รายงานสรุป'],
  ['/appointments', 'ปฏิทินนัดหมาย'],
  ['/pos', 'หน้าร้าน POS'],
  ['/bills', 'จัดการบิลเช่า'],
  ['/documents', 'จัดการเอกสาร'],
  ['/customers', 'ข้อมูลลูกค้า'],
  ['/products', 'สินค้า / สต็อก'],
  ['/quotations', 'ใบเสนอราคา'],
  ['/finance/statement', 'การเงิน'],
  ['/settings', 'ตั้งค่าระบบ'],
  ['/owner-permissions', 'จัดการสิทธิ์ & รายงาน'],
  ['/account', 'ตั้งค่าส่วนตัว'],
];

for (const [path, heading] of PAGES) {
  test(`เปิดหน้า ${heading} (${path})`, async ({ page }) => {
    const health = trackPageErrors(page);
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('เชื่อมต่อฐานข้อมูลล้มเหลว')).toHaveCount(0);
    health.expectNone();
  });
}
